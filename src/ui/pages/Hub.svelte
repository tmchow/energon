<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import type { AdminCleanupPreview, AdminCleanupResult, CatalogData, CatalogItem, HubData, LinkAccess } from '../types';
  import { api, jsonBody, errorMessage, RequestError } from '../api';
  import { stageFiles, publish, slugify, type StagedUpload, type PublishResult } from '../uploads';
  import { nextNumberedSlug } from "../../slugs";
  import { parseByteSize } from '../../config';
  import { hubCleanupDoneMessage, hubCleanupTarget } from '../hub-cleanup-target';
  import { registerHubTools } from '../model-context';
  import { setGatherFrame } from '../ambient-field';
  import PageTitle from '../components/PageTitle.svelte';
  import Card from '../components/Card.svelte';
  import DropZone from '../components/DropZone.svelte';
  import Field from '../components/Field.svelte';
  import Input from '../components/Input.svelte';
  import Select from '../components/Select.svelte';
  import UrlField from '../components/UrlField.svelte';
  import PasswordField from '../components/PasswordField.svelte';
  import SegmentedControl from '../components/SegmentedControl.svelte';
  import Button from '../components/Button.svelte';
  import Flash from '../components/Flash.svelte';
  import Catalog from '../components/Catalog.svelte';
  import CleanupReview from '../components/CleanupReview.svelte';
  import Dialog from '../components/Dialog.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Unit from '../components/Unit.svelte';

  let { data }: { data: HubData } = $props();
  let lists = $state<CatalogData>(untrack(() => data));
  let q = $state(untrack(() => data.query?.q || ''));
  let scope = $state(untrack(() => data.query?.scope || 'involved'));
  let sort = $state(untrack(() => data.query?.sort || 'updated'));
  let expires = $state<'any' | 'never'>(untrack(() => data.query?.expires?.kind === 'never' ? 'never' : 'any'));
  let expiresBefore = $state(untrack(() => data.query?.expires?.kind === 'before' ? data.query.expires.at : ''));
  let updatedBefore = $state(untrack(() => data.query?.updatedBefore || ''));
  let minSize = $state(untrack(() => data.query?.minSize != null ? String(data.query.minSize) : ''));
  let selectedSites = $state<string[]>([]);
  let selectedFiles = $state<string[]>([]);
  let matching = $state(false);
  let cleanupAction = $state<'set_ttl' | 'delete' | 'expire'>('set_ttl');
  let cleanupTtl = $state(untrack(() => data.policy.presets.some(p => p.id === '7d') ? '7d' : (data.policy.presets.find(p => p.id !== 'never')?.id || data.policy.default_ttl)));
  let cleanupPreview = $state<AdminCleanupPreview | null>(null);
  let cleanupBusy = $state(false);
  let cleanupConfirmOpen = $state(false);
  let cleanupConfirmError = $state('');
  let loading = $state(false);
  let staged = $state<StagedUpload | null>(null);
  let busy = $state(false);
  let publishing = $state(false);
  let stagePassword = $state('');
  let stageWritePassword = $state('');
  let stageAccessOpen = $state(false);
  let stageTtl = $state(untrack(() => data.policy.default_ttl));
  let stageWrite = $state(untrack(() => data.policy.write_policy));
  let dragDepth = $state(0);
  let dropFrame = $state<HTMLDivElement | null>(null);
  let messages = $state<{ id: number; tone: 'ok' | 'err'; text: string; url?: string; name?: string; password?: string; writePassword?: string; retry?: () => void }[]>([]);
  let messageSequence = 0;
  let catalogStatus = $state('');
  let target = $state<{ kind: 'site' | 'file'; item: CatalogItem } | null>(null);
  let moreOpen = $state(false);
  let confirmOpen = $state(false);
  let confirmAction = $state<'Delete' | 'Duplicate'>('Delete');
  let duplicateSlug = $state('');
  let passwordOpen = $state(false);
  let password = $state('');
  let writePassword = $state('');
  let loadedShare = $state('');
  let loadedWrite = $state('');
  let shareUnrecovered = $state(false);
  let writeUnrecovered = $state(false);
  let shareDoor = $state('off');
  let writeDoor = $state('off');
  let loadedShareOn = $state(false);
  let loadedWriteOn = $state(false);
  let passwordLoading = $state(false);
  let linkAccessLoaded = $state(false);
  let linkAccessSeq = 0;
  let writeOpen = $state(false);
  let write = $state('owner');
  let ttlOpen = $state(false);
  let ttl = $state(untrack(() => data.policy.default_ttl));
  let mutationBusy = $state(false);
  let modalError = $state('');
  let filepick: HTMLInputElement;
  let folderpick: HTMLInputElement;
  let timer: ReturnType<typeof setTimeout>;
  let requestSequence = 0;
  let controller: AbortController | undefined;
  let stageSequence = 0;

  const contentOrigin = $derived(data.content_origin.replace(/\/$/, ''));
  const handle = $derived(data.handle || 'you');
  const ttlOptions = $derived(data.policy.presets.map(p => ({ value: p.id, label: p.label })));
  const writeOptions = [{ value: 'owner', label: 'Only the creator' }, { value: 'org', label: 'Anyone in the org' }];
  const doorOptions = [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }];
  const targetName = $derived(target ? (target.item.slug ?? target.item.filename) : '');
  const targetPath = $derived(target ? `/account/${target.kind === 'site' ? 'sites' : 'files'}/${encodeURIComponent(target.item.id)}` : '');
  const ttlNote = $derived('You can delete this whenever you want. Expiration is only the automatic stop.' + (!data.policy.allow_unlimited && ttlOptions.length ? ` Longest allowed is ${ttlOptions.at(-1)?.label}.` : ''));
  const isTargetCreator = $derived(!!target && target.item.created_by === data.email);
  const canMutateTarget = $derived(!!target && (target.item.write_policy !== 'owner' || target.item.created_by === data.email));
  const writePasswordNote = $derived(target?.kind === 'file'
    ? 'Replaces that file only. Someone not on this host can PUT the public URL.'
    : 'Full control of served bytes, including replacing index.html. Someone not on this host can PUT or DELETE paths.');
  const shareDirty = $derived(shareDoor !== (loadedShareOn ? 'on' : 'off') || (shareDoor === 'on' && password.trim() !== loadedShare && !(shareUnrecovered && !password.trim())));
  const writeDirty = $derived(!isTargetCreator ? false : writeDoor !== (loadedWriteOn ? 'on' : 'off') || (writeDoor === 'on' && writePassword.trim() !== loadedWrite && !(writeUnrecovered && !writePassword.trim())));
  const sharePhraseOk = $derived(shareDoor === 'off' || !!password.trim() || (shareUnrecovered && shareDoor === 'on'));
  const writePhraseOk = $derived(!isTargetCreator || writeDoor === 'off' || !!writePassword.trim() || (writeUnrecovered && writeDoor === 'on'));
  const linkAccessReady = $derived(linkAccessLoaded && !passwordLoading && (shareDirty || writeDirty) && sharePhraseOk && writePhraseOk);
  const linkAccessBusy = $derived(mutationBusy || passwordLoading || !linkAccessLoaded);
  const filtered = $derived(!!(q.trim() || scope !== 'involved' || sort !== 'updated' || expires === 'never' || expiresBefore.trim() || updatedBefore.trim() || minSize.trim()));
  const hasSelection = $derived(matching || selectedSites.length + selectedFiles.length > 0);
  const selectionLabel = $derived(matching ? 'Everything matching these filters' : `${selectedSites.length + selectedFiles.length} selected`);
  const cleanupActionOptions = [
    { value: 'set_ttl', label: 'Set expiry' },
    { value: 'expire', label: 'Expire soon' },
    { value: 'delete', label: 'Delete' },
  ];

  const MAX_MESSAGES = 6;
  function message(text: string, tone: 'ok' | 'err' = 'ok', result?: PublishResult, retry?: () => void) {
    messages = [{ id: ++messageSequence, tone, text, url: result?.url, name: result?.slug || result?.filename, password: result?.password, writePassword: result?.write_password, retry }, ...messages].slice(0, MAX_MESSAGES);
  }
  function dismiss(id: number) { messages = messages.filter((item) => item.id !== id); }
  function count(n: number, noun: string) { return `${n} ${noun}${n === 1 ? '' : 's'}`; }
  // The server ignores malformed filters instead of rejecting them, so refuse them here with the same grammar it uses.
  const validTimestamp = (raw: string) => !raw.trim() || Number.isFinite(Date.parse(raw.trim()));
  const validSize = (raw: string) => !raw.trim() || parseByteSize(raw) !== null;
  const dateError = 'Enter a date like 2026-01-01 or a full ISO timestamp.';
  const expiresBeforeError = $derived(validTimestamp(expiresBefore) ? '' : dateError);
  const updatedBeforeError = $derived(validTimestamp(updatedBefore) ? '' : dateError);
  const minSizeError = $derived(validSize(minSize) ? '' : 'Enter bytes or a size like 500kb, 1mb, or 2gb.');
  const filtersValid = $derived(!expiresBeforeError && !updatedBeforeError && !minSizeError);
  async function refresh(only?: 'sites' | 'files') {
    const sequence = ++requestSequence;
    controller?.abort();
    if (!filtersValid) { loading = false; return; }
    controller = new AbortController(); loading = true;
    const query = new URLSearchParams({ q: q.trim(), scope, sort });
    if (expires === 'never') query.set('expires', 'never');
    else if (expiresBefore.trim()) query.set('expires_before', expiresBefore.trim());
    if (updatedBefore.trim()) query.set('updated_before', updatedBefore.trim());
    if (minSize.trim()) query.set('min_size', minSize.trim());
    if (only && lists[`${only}_cursor`]) query.set(`${only}_cursor`, lists[`${only}_cursor`]!);
    try {
      const next = await api<CatalogData>('/account/data?' + query, { signal: controller.signal });
      if (sequence !== requestSequence) return;
      if (!only) lists = next;
      else lists = { ...lists, [only]: [...lists[only], ...next[only]], [`${only}_total`]: next[`${only}_total`], [`${only}_cursor`]: next[`${only}_cursor`] };
      catalogStatus = only ? `Loaded ${count(lists[only].length, only === 'sites' ? 'site' : 'file')} of ${lists[`${only}_total`]}.` : `${count(lists.sites_total, 'site')} and ${count(lists.files_total, 'file')}${filtered ? ' match' : ''}.`;
    } catch (error) {
      if (sequence === requestSequence && !(error instanceof DOMException && error.name === 'AbortError')) {
        catalogStatus = 'The catalog did not load.';
        message(`The catalog did not load. ${errorMessage(error)}`, 'err', undefined, () => { void refresh(only); });
      }
    } finally { if (sequence === requestSequence) loading = false; }
  }
  function search() {
    clearTimeout(timer);
    requestSequence++; controller?.abort();
    clearCleanupSelection();
    timer = setTimeout(() => refresh(), 200);
  }
  function applyFilters() {
    clearTimeout(timer);
    clearCleanupSelection();
    refresh();
  }
  function dropCleanupPreview() {
    cleanupPreview = null;
    cleanupConfirmOpen = false;
    cleanupConfirmError = '';
  }
  function clearCleanupSelection() {
    selectedSites = [];
    selectedFiles = [];
    matching = false;
    dropCleanupPreview();
  }
  function siteSelected(id: string) { return matching || selectedSites.includes(id); }
  function fileSelected(id: string) { return matching || selectedFiles.includes(id); }
  function materializeMatching() {
    if (!matching) return;
    matching = false;
    selectedSites = lists.sites.map((item) => item.id);
    selectedFiles = lists.files.map((item) => item.id);
  }
  function toggleItem(kind: 'site' | 'file', item: CatalogItem, on: boolean) {
    materializeMatching();
    if (kind === 'site') {
      selectedSites = on ? (selectedSites.includes(item.id) ? selectedSites : [...selectedSites, item.id]) : selectedSites.filter((id) => id !== item.id);
    } else {
      selectedFiles = on ? (selectedFiles.includes(item.id) ? selectedFiles : [...selectedFiles, item.id]) : selectedFiles.filter((id) => id !== item.id);
    }
    if (!matching && selectedSites.length + selectedFiles.length === 0) dropCleanupPreview();
  }
  function toggleVisible(kind: 'site' | 'file', on: boolean) {
    materializeMatching();
    const visible = (kind === 'site' ? lists.sites : lists.files).map((item) => item.id);
    if (kind === 'site') {
      selectedSites = on ? [...new Set([...selectedSites, ...visible])] : selectedSites.filter((id) => !visible.includes(id));
    } else {
      selectedFiles = on ? [...new Set([...selectedFiles, ...visible])] : selectedFiles.filter((id) => !visible.includes(id));
    }
    if (!matching && selectedSites.length + selectedFiles.length === 0) dropCleanupPreview();
  }
  function selectMatching() {
    matching = true;
    selectedSites = [];
    selectedFiles = [];
  }
  function cleanupTarget(): Record<string, unknown> | null {
    return hubCleanupTarget(
      matching ? { matching: true } : { matching: false, sites: selectedSites, files: selectedFiles },
      { q, scope, expires, expiresBefore, updatedBefore, minSize },
    );
  }
  function cleanupBody(confirm?: string): Record<string, unknown> | null {
    const target = cleanupTarget();
    if (!target) return null;
    const body: Record<string, unknown> = { target, action: cleanupAction };
    if (cleanupAction === 'set_ttl') body.ttl = cleanupTtl;
    if (confirm) body.confirm = confirm;
    return body;
  }
  async function previewCleanup() {
    const body = cleanupBody();
    if (!body || cleanupBusy) return;
    cleanupBusy = true; cleanupConfirmError = '';
    try {
      cleanupPreview = await api<AdminCleanupPreview>('/account/cleanup', jsonBody('POST', body));
    } catch (error) { cleanupPreview = null; message(errorMessage(error), 'err'); }
    finally { cleanupBusy = false; }
  }
  async function confirmCleanup() {
    if (!cleanupPreview || cleanupBusy) return;
    const body = cleanupBody(cleanupPreview.confirm);
    if (!body) {
      dropCleanupPreview();
      return;
    }
    cleanupBusy = true; cleanupConfirmError = '';
    try {
      const result = await api<AdminCleanupResult>('/account/cleanup', jsonBody('POST', body));
      cleanupConfirmOpen = false;
      cleanupPreview = null;
      clearCleanupSelection();
      message(hubCleanupDoneMessage(result.action, result.applied.total));
      await refresh();
    } catch (error) {
      if (error instanceof RequestError && error.status === 409) {
        const next = cleanupBody();
        if (!next) dropCleanupPreview();
        else {
          cleanupPreview = await api<AdminCleanupPreview>('/account/cleanup', jsonBody('POST', next)).catch(() => cleanupPreview);
          cleanupConfirmError = 'The selection changed since this preview. Review the new count and confirm again.';
        }
      } else cleanupConfirmError = errorMessage(error);
    } finally { cleanupBusy = false; }
  }
  function resetStage() {
    stageSequence++; staged = null; stagePassword = ''; stageWritePassword = ''; stageAccessOpen = false;
  }
  async function choose(files: File[], entries: FileSystemEntry[] = [], folder = false) {
    if (busy) return;
    const sequence = ++stageSequence; busy = true;
    try {
      const next = await stageFiles(files, entries, folder);
      if (sequence !== stageSequence || !next) return;
      if (!next.files.length) throw new Error('That folder is empty. Choose a folder containing files.');
      staged = next; stagePassword = ''; stageWritePassword = ''; stageAccessOpen = false;
      await tick();
      document.getElementById(next.kind === 'loose' ? 'stage-filename' : 'stage-slug')?.focus();
    } catch (error) { message(errorMessage(error), 'err'); }
    finally { busy = false; }
  }
  async function picked(event: Event, folder = false) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files || [])]; input.value = '';
    await choose(files, [], folder);
  }
  async function launch(event: SubmitEvent) {
    event.preventDefault();
    if (!staged || busy) return;
    busy = true; publishing = true;
    staged.slug = slugify(staged.slug);
    const upload = staged;
    try {
      const result = await publish(upload, { password: stagePassword.trim(), write_password: stageWritePassword.trim(), ttl: stageTtl, write_policy: stageWrite });
      message('Published', 'ok', { ...result, password: result.password || stagePassword.trim() || undefined, write_password: result.write_password || stageWritePassword.trim() || undefined });
      resetStage(); await refresh();
    } catch (error) {
      message(errorMessage(error), 'err'); await refresh();
    } finally { busy = false; publishing = false; }
  }
  function selectTarget(kind: 'site' | 'file', item: CatalogItem) { target = { kind, item }; modalError = ''; }
  function deleteItem(kind: 'site' | 'file', item: CatalogItem) { selectTarget(kind, item); confirmAction = 'Delete'; confirmOpen = true; }
  function editPassword(kind: 'site' | 'file', item: CatalogItem) {
    selectTarget(kind, item);
    password = '';
    writePassword = '';
    loadedShare = '';
    loadedWrite = '';
    shareUnrecovered = false;
    writeUnrecovered = false;
    loadedShareOn = !!item.password_protected;
    loadedWriteOn = !!item.write_password_protected;
    shareDoor = loadedShareOn ? 'on' : 'off';
    writeDoor = item.created_by === data.email && loadedWriteOn ? 'on' : 'off';
    linkAccessLoaded = false;
    passwordOpen = true;
    void loadLinkAccess();
  }
  function fillPhrase(): string {
    const words = data.words;
    if (!words.length) return '';
    const random = crypto.getRandomValues(new Uint32Array(5));
    return [...random].map(n => words[n % words.length]).join('-');
  }
  function setShareDoor(value: string) {
    shareDoor = value === 'on' ? 'on' : 'off';
    if (shareDoor === 'on' && !password.trim() && !shareUnrecovered) password = fillPhrase();
  }
  function setWriteDoor(value: string) {
    writeDoor = value === 'on' ? 'on' : 'off';
    if (writeDoor === 'on' && !writePassword.trim() && !writeUnrecovered) writePassword = fillPhrase();
  }
  async function loadLinkAccess() {
    if (!target) return;
    const seq = ++linkAccessSeq;
    const path = `/account/${target.kind === 'site' ? 'sites' : 'files'}/${encodeURIComponent(target.item.id)}`;
    passwordLoading = true;
    modalError = '';
    try {
      const detail = await api<LinkAccess>(path);
      if (seq !== linkAccessSeq || !passwordOpen) return;
      loadedShareOn = !!detail.password_protected;
      loadedShare = detail.password || '';
      password = loadedShare;
      shareUnrecovered = loadedShareOn && !detail.password;
      shareDoor = loadedShareOn ? 'on' : 'off';
      if (isTargetCreator) {
        loadedWriteOn = !!detail.write_password_protected;
        loadedWrite = detail.write_password || '';
        writePassword = loadedWrite;
        writeUnrecovered = loadedWriteOn && !detail.write_password;
        writeDoor = loadedWriteOn ? 'on' : 'off';
      } else {
        loadedWriteOn = false;
        loadedWrite = '';
        writePassword = '';
        writeUnrecovered = false;
        writeDoor = 'off';
      }
      linkAccessLoaded = true;
    } catch (error) {
      if (seq === linkAccessSeq && passwordOpen) modalError = errorMessage(error);
    } finally { if (seq === linkAccessSeq) passwordLoading = false; }
  }
  function openMore(kind: 'site' | 'file', item: CatalogItem) { selectTarget(kind, item); moreOpen = true; }
  async function mutate(run: () => Promise<void>) {
    if (mutationBusy) return;
    mutationBusy = true; modalError = '';
    try { await run(); await refresh(); }
    catch (error) { modalError = errorMessage(error); message(modalError, 'err'); }
    finally { mutationBusy = false; }
  }
  async function duplicate() {
    if (!target) return;
    if (target.kind === 'file') {
      await mutate(async () => { message('Duplicated', 'ok', await api<PublishResult>('/account/files', jsonBody('POST', { duplicate_from: target!.item.id }))); });
      return;
    }
    duplicateSlug = nextNumberedSlug(target.item.slug ?? target.item.id);
    confirmAction = 'Duplicate'; confirmOpen = true;
  }
  async function confirm(value: string) {
    if (!target) return;
    await mutate(async () => {
      if (confirmAction === 'Delete') { await api(targetPath, { method: 'DELETE' }); message(`Deleted ${targetName}.`); }
      else message('Duplicated', 'ok', await api<PublishResult>('/account/sites', jsonBody('POST', { slug: slugify(value), duplicate_from: target!.item.id })));
      confirmOpen = false;
    });
  }
  async function saveLinkAccess() {
    if (!target || !linkAccessReady) return;
    const body: Record<string, unknown> = {};
    if (shareDirty) body.password = shareDoor === 'off' ? '' : password.trim();
    if (isTargetCreator && writeDirty) body.write_password = writeDoor === 'off' ? '' : writePassword.trim();
    if (!Object.keys(body).length) return;
    await mutate(async () => {
      const result = await api<PublishResult>(targetPath, jsonBody('PATCH', body));
      const bits: string[] = [];
      if ('password' in body) bits.push(result.password_protected ? `Share password set for ${targetName}.` : `Share password removed from ${targetName}.`);
      if ('write_password' in body) bits.push(result.write_password_protected ? `Write password set for ${targetName}.` : `Write password removed from ${targetName}.`);
      message(bits.join(' ') || 'Link access updated.', 'ok', { url: '', password: result.password, write_password: result.write_password });
      passwordOpen = false;
      password = '';
      writePassword = '';
      loadedShare = '';
      loadedWrite = '';
      shareUnrecovered = false;
      writeUnrecovered = false;
      shareDoor = 'off';
      writeDoor = 'off';
      loadedShareOn = false;
      loadedWriteOn = false;
      linkAccessLoaded = false;
    });
  }
  async function saveWrite() {
    await mutate(async () => { await api(targetPath, jsonBody('PATCH', { write_policy: write })); message('Who can write updated.'); writeOpen = false; });
  }
  async function saveTtl() {
    await mutate(async () => { await api(targetPath, jsonBody('PATCH', { ttl })); message('Expiration updated.'); ttlOpen = false; });
  }
  const moreItems = $derived(target ? [
    ...(target.kind === 'file' || (target.item.file_count ?? 0) > 0 ? [{ label: target.kind === 'site' ? 'Download zip' : 'Download', icon: 'download' as const, href: `${targetPath}/${target.kind === 'site' ? 'export' : 'download'}` }] : []),
    { label: 'Duplicate', icon: 'fork' as const, onClick: duplicate },
    { label: target.item.password_protected || target.item.write_password_protected ? 'Change or remove password' : 'Set password', icon: 'lock' as const, onClick: () => { moreOpen = false; editPassword(target!.kind, target!.item); } },
    ...(target.item.created_by === data.email ? [{ label: 'Who can write', icon: 'person' as const, onClick: () => { write = target!.item.write_policy; writeOpen = true; } }] : []),
    ...(canMutateTarget ? [{ label: 'Change expiration', icon: 'clock' as const, onClick: () => { ttl = data.policy.default_ttl; ttlOpen = true; } }] : []),
    { label: 'Delete', icon: 'trash' as const, danger: true, onClick: () => { confirmAction = 'Delete'; confirmOpen = true; } },
  ] : []);

  onMount(() => {
    const unregister = registerHubTools();
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const enter = (event: DragEvent) => { if (hasFiles(event)) { event.preventDefault(); dragDepth++; } };
    const over = (event: DragEvent) => { if (hasFiles(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; } };
    const leave = (event: DragEvent) => { if (hasFiles(event)) dragDepth = Math.max(0, dragDepth - 1); };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); dragDepth = 0;
      const entries = [...(event.dataTransfer?.items || [])].map(item => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => !!entry);
      void choose([...(event.dataTransfer?.files || [])], entries);
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    };
    document.addEventListener('dragenter', enter); document.addEventListener('dragover', over); document.addEventListener('dragleave', leave); document.addEventListener('drop', drop);
    return () => { unregister(); document.removeEventListener('dragenter', enter); document.removeEventListener('dragover', over); document.removeEventListener('dragleave', leave); document.removeEventListener('drop', drop); };
  });
  onDestroy(() => { clearTimeout(timer); controller?.abort(); stageSequence++; });
  $effect(() => {
    if (stagePassword.trim() || stageWritePassword.trim()) stageAccessOpen = true;
  });
  $effect(() => { setGatherFrame(dragDepth > 0 ? dropFrame : null); });
  onDestroy(() => setGatherFrame(null));
</script>

<main class="en-wrap">
  <PageTitle wide title="Publish a document, prototype, or file."><p class="en-lede">Upload here and get a link. Or <a href="/setup">connect your agent</a> to publish for you.</p></PageTitle>
  <div id="messages" class="en-hub-messages">{#each messages as item (item.id)}<Flash tone={item.tone} password={item.password} writePassword={item.writePassword} onDismiss={() => dismiss(item.id)} action={item.retry ? { label: 'Try again', onclick: () => { dismiss(item.id); item.retry?.(); } } : undefined}>{item.text}{#if item.url} <a href={item.url}>{item.name}</a>{/if}</Flash>{/each}</div>
  <div class="en-space-after"><Card charged tight>
    <DropZone over={dragDepth > 0} {busy} onFiles={() => filepick.click()} onFolder={() => folderpick.click()} children={staged ? stage : undefined} />
    <input bind:this={filepick} id="filepick" class="en-sr-only" type="file" multiple tabindex="-1" aria-hidden="true" onchange={e => picked(e)} />
    <input bind:this={folderpick} id="folderpick" class="en-sr-only" type="file" webkitdirectory tabindex="-1" aria-hidden="true" onchange={e => picked(e, true)} />
  </Card></div>
  <div class="en-stack en-space-after">
    <Card title="Sites" hint={`${lists.sites.length < lists.sites_total ? `${lists.sites.length} of ` : ''}${count(lists.sites_total, 'site')}`} tight>
      <div class="en-card-body en-toolbar"><Input size="md" id="q" class="en-search" type="search" placeholder="Search slugs and filenames" aria-label="Search slugs and filenames" bind:value={q} oninput={search} />
        <SegmentedControl id="scope" bind:value={scope} ariaLabel="Catalog scope" onChange={() => { applyFilters(); }} options={[{ value: 'involved', label: 'Your work' }, { value: 'created', label: 'Created by you' }, { value: 'edited', label: 'Last edited by you' }]} />
        <Select id="sort" aria-label="Sort" bind:value={sort} onchange={() => refresh()} options={[{ value: 'updated', label: 'Updated' }, { value: 'name', label: 'Name' }, { value: 'size', label: 'Size' }, { value: 'age', label: 'Oldest' }]} />
      </div>
      <div id="catalog-filters" class="en-card-body en-catalog-filters">
        <Field label="Expiry"><SegmentedControl id="catalog-expires" ariaLabel="Expiry filter" options={[{ value: 'any', label: 'Any' }, { value: 'never', label: 'Never expires' }]} bind:value={expires} onChange={() => { expiresBefore = ''; applyFilters(); }} /></Field>
        <Field label="Expires before" htmlFor="catalog-expires-before" note="A date, 2026-01-01, or an ISO timestamp." noteId="catalog-expires-before-note" error={expiresBeforeError} errorId="catalog-expires-before-error"><Input id="catalog-expires-before" bind:value={expiresBefore} mono placeholder="2026-01-01" disabled={expires === 'never'} aria-invalid={expiresBeforeError ? 'true' : undefined} aria-describedby={expiresBeforeError ? 'catalog-expires-before-error catalog-expires-before-note' : 'catalog-expires-before-note'} onchange={applyFilters} /></Field>
        <Field label="Last written before" htmlFor="catalog-updated-before" note="A date, 2026-01-01, or an ISO timestamp." noteId="catalog-updated-before-note" error={updatedBeforeError} errorId="catalog-updated-before-error"><Input id="catalog-updated-before" bind:value={updatedBefore} mono placeholder="2026-01-01" aria-invalid={updatedBeforeError ? 'true' : undefined} aria-describedby={updatedBeforeError ? 'catalog-updated-before-error catalog-updated-before-note' : 'catalog-updated-before-note'} onchange={applyFilters} /></Field>
        <Field label="Minimum size" htmlFor="catalog-min-size" note="Bytes, or a size like 500kb, 1mb, or 2gb." noteId="catalog-min-size-note" error={minSizeError} errorId="catalog-min-size-error"><Input id="catalog-min-size" bind:value={minSize} placeholder="1mb" aria-invalid={minSizeError ? 'true' : undefined} aria-describedby={minSizeError ? 'catalog-min-size-error catalog-min-size-note' : 'catalog-min-size-note'} onchange={applyFilters} /></Field>
      </div>
      <p id="catalog-status" class="en-sr-only" role="status">{catalogStatus}</p>
      <div class="en-card-body en-catalog-select">
        <Button id="catalog-select-matching" size="md" onclick={selectMatching}>Select all matching these filters</Button>
      </div>
      <div id="catalog-cleanup" class="en-card-body en-catalog-cleanup" hidden={!hasSelection}>
        <p class="en-catalog-cleanup-count">{selectionLabel}</p>
        <Button id="catalog-cleanup-clear" size="md" onclick={clearCleanupSelection}>Clear</Button>
        <Field label="Action" note="Set expiry is the safe default. Delete has no recycle bin.">
          <SegmentedControl id="catalog-cleanup-action" ariaLabel="Cleanup action" options={cleanupActionOptions} bind:value={cleanupAction} disabled={cleanupBusy} />
        </Field>
        {#if cleanupAction === 'set_ttl'}
          <Field label="New expiry" htmlFor="catalog-cleanup-ttl">
            <Select id="catalog-cleanup-ttl" aria-label="New expiry" bind:value={cleanupTtl} options={ttlOptions} disabled={cleanupBusy} />
          </Field>
        {/if}
        <Button id="catalog-cleanup-preview" variant="primary" disabled={cleanupBusy} onclick={() => { void previewCleanup(); }}>{cleanupBusy && !cleanupConfirmOpen ? 'Previewing…' : 'Preview'}</Button>
      </div>
      <div id="sites" aria-busy={loading}><Catalog kind="site" items={lists.sites} cursor={lists.sites_cursor} busy={loading} filtered={filtered} writePolicyDefault={data.policy.write_policy} selected={siteSelected} onToggle={(item, on) => toggleItem('site', item, on)} onToggleVisible={(on) => toggleVisible('site', on)} onMore={item => openMore('site', item)} onPassword={item => editPassword('site', item)} onDelete={item => deleteItem('site', item)} onLoadMore={() => refresh('sites')} /></div>
    </Card>
    <Card title="Files" hint={`${lists.files.length < lists.files_total ? `${lists.files.length} of ` : ''}${count(lists.files_total, 'file')}`} tight>
      <div id="files" aria-busy={loading}><Catalog kind="file" items={lists.files} cursor={lists.files_cursor} busy={loading} filtered={filtered} writePolicyDefault={data.policy.write_policy} selected={fileSelected} onToggle={(item, on) => toggleItem('file', item, on)} onToggleVisible={(on) => toggleVisible('file', on)} onMore={item => openMore('file', item)} onPassword={item => editPassword('file', item)} onDelete={item => deleteItem('file', item)} onLoadMore={() => refresh('files')} /></div>
    </Card>
    <CleanupReview preview={cleanupPreview} action={cleanupAction} bind:confirmOpen={cleanupConfirmOpen} bind:confirmError={cleanupConfirmError} busy={cleanupBusy} sampleId="catalog-cleanup-sample" confirmId="catalog-cleanup-dlg" confirmButtonId="catalog-cleanup-confirm" onConfirm={() => { void confirmCleanup(); }} />
    <Card className="en-hub-export" id="account-export" title="Download what you own">
      <div class="en-stack">
        <p class="en-lede">Sites and loose files keyed to this account, as one zip, before a bulk cleanup. Work you only edited is not included. Same size and file-count caps as a site export.</p>
        <Button href="/account/export" size="md">Download everything you own</Button>
      </div>
    </Card>
  </div>
  <p class="en-lede">Your catalog includes work you created or last edited. To revise an existing file at the same link, ask your agent to update it; uploading it here creates a new file. Links show current contents until expiry or deletion.</p>
</main>

{#snippet stage()}{#if staged}
  <form id="stage" class="en-stage" onsubmit={launch}>
    <div class="en-stage-status" id="stage-status"><Unit size={5} />{staged.kind === 'loose' ? '1 file ready' : `${count(staged.files.length, 'file')} ready`}</div>
    {#if staged.kind === 'loose'}<div id="stage-loose"><Field label="Filename" htmlFor="stage-filename" note="The last part of the public URL."><UrlField id="stage-filename" prefix={`${contentOrigin}/${handle}/f/{id}/`} bind:value={staged.filename} disabled={busy} /></Field></div>
    {:else}<div id="stage-site"><Field label="Site slug" htmlFor="stage-slug" note="The last part of the public URL."><UrlField id="stage-slug" prefix={`${contentOrigin}/${handle}/s/{id}/`} suffix="/" bind:value={staged.slug} disabled={busy} /></Field></div>{/if}
    <Field label="Expiration" htmlFor="stage-ttl" noteId="stage-ttl-note" note={ttlNote}><Select id="stage-ttl" aria-describedby="stage-ttl-note" options={ttlOptions} bind:value={stageTtl} disabled={busy} /></Field>
    <Field label="Who can write" htmlFor="stage-write" note="Controls who with a token can update or delete this work. It does not grant or deny the write-password door."><Select id="stage-write" aria-label="Who can write" options={writeOptions} bind:value={stageWrite} disabled={busy} /></Field>
    <details id="stage-access" class="en-stage-access" bind:open={stageAccessOpen}>
      <summary>Link access</summary>
      <Field label="Share password" htmlFor="stage-password" noteId="stage-password-note" note="Leave empty so anyone with the link can open it. Valid API tokens on this host can read the work even with a share password."><PasswordField id="stage-password" generateId="stage-pw-gen" copyId="stage-pw-copy" words={data.words} bind:value={stagePassword} describedby="stage-password-note" disabled={busy} /></Field>
      <Field label="Write password" htmlFor="stage-write-password" noteId="stage-write-password-note" note={staged.kind === 'loose' ? 'Replaces this file only. Leave empty to keep guests from writing.' : 'Full control of served bytes, including replacing index.html. Leave empty to keep guests from writing.'}><PasswordField id="stage-write-password" generateId="stage-wpw-gen" copyId="stage-wpw-copy" words={data.words} bind:value={stageWritePassword} describedby="stage-write-password-note" disabled={busy} /></Field>
    </details>
    <div class="en-stage-actions"><Button id="stage-cancel" onclick={resetStage} disabled={busy}>Cancel</Button><Button type="submit" id="stage-go" variant="primary" disabled={busy}>{publishing ? 'Publishing…' : busy ? 'Preparing…' : 'Publish'}</Button></div>
  </form>
{/if}{/snippet}

<Sheet bind:open={moreOpen} title={targetName} meta={target ? `${target.kind === 'site' ? 'Site' : 'File'} · ${target.item.write_policy === 'org' ? 'Anyone in the org' : 'Only the creator'}` : ''} items={moreItems} />
<ConfirmDialog bind:open={confirmOpen} title={`${confirmAction} ${target?.kind || 'site'}`} message={confirmAction === 'Delete' ? `This removes the ${target?.kind} and its bytes. There is no recycle bin. Type the name to confirm.` : 'Creates a new site you own. Expiration starts now. The share password and write password are not copied.'}
  label={confirmAction === 'Delete' ? `Type “${targetName}” to delete` : 'New slug'} initial={confirmAction === 'Duplicate' ? duplicateSlug : ''} match={confirmAction === 'Delete' ? targetName : undefined} action={confirmAction} danger={confirmAction === 'Delete'} busy={mutationBusy} onConfirm={confirm} error={modalError} />
<Dialog dismissible={!mutationBusy} id="pw-dlg" bind:open={passwordOpen} title="Link access" message="Copy a phrase to share the link. Turn a password off and save to remove it.">
  {#if modalError}<Flash tone="err">{modalError}</Flash>{/if}
  <form onsubmit={e => { e.preventDefault(); void saveLinkAccess(); }}>
    <Field label="Share password" htmlFor={shareDoor === 'on' ? 'pw-dlg-input' : undefined} noteId="pw-dlg-note" note={shareDoor === 'off' ? 'Anyone with the link can open it. Valid API tokens on this host can still read the work.' : shareUnrecovered && !password.trim() ? 'This password was set before Energon kept phrases for display. Generate a new one to copy it, or turn it off.' : 'Anyone with this password can open the link. Valid API tokens on this host can still read the work.'}>
      {#snippet action()}
        <SegmentedControl id="pw-dlg-share-door" className="en-seg--door" bind:value={shareDoor} onChange={setShareDoor} ariaLabel="Share password" options={doorOptions} disabled={linkAccessBusy} />
      {/snippet}
      {#if shareDoor === 'on'}
        <PasswordField id="pw-dlg-input" generateId="pw-dlg-gen" copyId="pw-dlg-copy" describedby="pw-dlg-note" words={data.words} bind:value={password} disabled={linkAccessBusy} />
      {/if}
    </Field>
    {#if isTargetCreator}
      <Field label="Write password" htmlFor={writeDoor === 'on' ? 'pw-dlg-write-input' : undefined} noteId="pw-dlg-write-note" note={writeDoor === 'off' ? 'Turn on so someone not on this host can write. Valid tokens still follow Who can write.' : writeUnrecovered && !writePassword.trim() ? 'This password was set before Energon kept phrases for display. Generate a new one to copy it, or turn it off.' : writePasswordNote}>
        {#snippet action()}
          <SegmentedControl id="pw-dlg-write-door" className="en-seg--door" bind:value={writeDoor} onChange={setWriteDoor} ariaLabel="Write password" options={doorOptions} disabled={linkAccessBusy} />
        {/snippet}
        {#if writeDoor === 'on'}
          <PasswordField id="pw-dlg-write-input" generateId="pw-dlg-write-gen" copyId="pw-dlg-write-copy" describedby="pw-dlg-write-note" words={data.words} bind:value={writePassword} disabled={linkAccessBusy} />
        {/if}
      </Field>
    {/if}
    <div class="en-dialog-actions"><Button disabled={mutationBusy} onclick={() => passwordOpen = false}>Cancel</Button><Button id="pw-dlg-ok" type="submit" variant="primary" disabled={mutationBusy || !linkAccessReady}>Save</Button></div>
  </form>
</Dialog>
<Dialog dismissible={!mutationBusy} id="write-dlg" bind:open={writeOpen} title="Who can write" message="Only the creator can change this.">
  {#if modalError}<Flash tone="err">{modalError}</Flash>{/if}
  <form onsubmit={e => { e.preventDefault(); void saveWrite(); }}><Field label="Who can write" htmlFor="write-dlg-select"><Select id="write-dlg-select" aria-label="Who can write" options={writeOptions} bind:value={write} disabled={mutationBusy} /></Field>
    <div class="en-dialog-actions"><Button disabled={mutationBusy} onclick={() => writeOpen = false}>Cancel</Button><Button id="write-dlg-ok" type="submit" variant="primary" disabled={mutationBusy}>Save</Button></div>
  </form>
</Dialog>
<Dialog dismissible={!mutationBusy} id="ttl-dlg" bind:open={ttlOpen} title="Expiration" message="The new timer starts now, not from when this was published.">
  {#if modalError}<Flash tone="err">{modalError}</Flash>{/if}
  <form onsubmit={e => { e.preventDefault(); void saveTtl(); }}><Field label="Expiration" htmlFor="ttl-dlg-select" noteId="ttl-dlg-note" note={ttlNote}><Select id="ttl-dlg-select" aria-describedby="ttl-dlg-note" options={ttlOptions} bind:value={ttl} disabled={mutationBusy} /></Field>
    <div class="en-dialog-actions"><Button disabled={mutationBusy} onclick={() => ttlOpen = false}>Cancel</Button><Button id="ttl-dlg-ok" type="submit" variant="primary" disabled={mutationBusy}>Save</Button></div>
  </form>
</Dialog>
<div class="en-drop-overlay-bg" hidden={dragDepth === 0} aria-hidden="true"></div>
<div id="drop-overlay" class="en-drop-overlay" hidden={dragDepth === 0} aria-hidden={dragDepth === 0}><div class="en-drop-overlay-frame" bind:this={dropFrame}><div class="en-drop-title">Drop to stage</div><div class="en-drop-sub">A folder or zip becomes a site. One file gets a stable URL. Nothing is written until you Publish.</div></div></div>
