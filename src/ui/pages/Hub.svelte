<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import type { CatalogData, CatalogItem, HubData } from '../types';
  import { api, jsonBody, errorMessage } from '../api';
  import { stageFiles, publish, firstFreeSlug, slugify, isCollision, type StagedUpload, type PublishResult } from '../uploads';
  import { nextNumberedSlug } from "../../slugs";
  import { registerHubTools } from '../model-context';
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
  import Dialog from '../components/Dialog.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Unit from '../components/Unit.svelte';

  let { data }: { data: HubData } = $props();
  let lists = $state<CatalogData>(untrack(() => data));
  let q = $state(untrack(() => data.query?.q || ''));
  let scope = $state(untrack(() => data.query?.scope || 'involved'));
  let sort = $state(untrack(() => data.query?.sort || 'updated'));
  let loading = $state(false);
  let staged = $state<StagedUpload | null>(null);
  let busy = $state(false);
  let publishing = $state(false);
  let stagePassword = $state('');
  let stageWritePassword = $state('');
  let stageAccessOpen = $state(false);
  let stageTtl = $state(untrack(() => data.policy.default_ttl));
  let stageWrite = $state(untrack(() => data.policy.write_policy));
  let conflictSlug = $state('');
  let overwriteSlug = $state('');
  let stageNote = $state('');
  let dragDepth = $state(0);
  let messages = $state<{ tone: 'ok' | 'err'; text: string; url?: string; name?: string; password?: string; writePassword?: string }[]>([]);
  let target = $state<{ kind: 'site' | 'file'; item: CatalogItem } | null>(null);
  let moreOpen = $state(false);
  let confirmOpen = $state(false);
  let confirmAction = $state<'Delete' | 'Duplicate'>('Delete');
  let duplicateSlug = $state('');
  let passwordOpen = $state(false);
  let password = $state('');
  let writePassword = $state('');
  let shareMode = $state('unchanged');
  let writeMode = $state('unchanged');
  let writeOpen = $state(false);
  let write = $state('owner');
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
  const writeOptions = [{ value: 'owner', label: 'Only the creator' }, { value: 'instance', label: 'Anyone with a token on this host.' }];
  const targetName = $derived(target ? (target.item.slug ?? target.item.filename) : '');
  const targetPath = $derived(target ? `/account/${target.kind === 'site' ? 'sites' : 'files'}/${encodeURIComponent(target.item.slug ?? target.item.id)}` : '');
  const ttlNote = $derived('You can delete this whenever you want. Expiration is only the automatic stop.' + (!data.policy.allow_unlimited && ttlOptions.length ? ` Longest allowed is ${ttlOptions.at(-1)?.label}.` : ''));
  const isTargetCreator = $derived(!!target && target.item.created_by === data.email);
  const writePasswordNote = $derived(target?.kind === 'file'
    ? 'Replaces that file only. Someone not on this host can PUT the public URL.'
    : 'Full control of served bytes, including replacing index.html. Someone not on this host can PUT or DELETE paths.');
  function passwordActionModes(isSet: boolean) {
    return isSet
      ? [{ value: 'unchanged', label: 'Keep' }, { value: 'replace', label: 'Replace' }, { value: 'remove', label: 'Remove' }]
      : [{ value: 'unchanged', label: 'Keep unset' }, { value: 'replace', label: 'Set' }];
  }
  const shareModes = $derived(passwordActionModes(!!target?.item.password_protected));
  const writeModes = $derived(passwordActionModes(!!target?.item.write_password_protected));
  const linkAccessReady = $derived(
    shareMode === 'remove' ||
    (shareMode === 'replace' && !!password.trim()) ||
    (isTargetCreator && (writeMode === 'remove' || (writeMode === 'replace' && !!writePassword.trim())))
  );

  function message(text: string, tone: 'ok' | 'err' = 'ok', result?: PublishResult) {
    messages = [{ tone, text, url: result?.url, name: result?.slug || result?.filename, password: result?.password, writePassword: result?.write_password }, ...messages];
  }
  async function refresh(only?: 'sites' | 'files') {
    const sequence = ++requestSequence;
    controller?.abort(); controller = new AbortController(); loading = true;
    const query = new URLSearchParams({ q: q.trim(), scope, sort });
    if (only && lists[`${only}_cursor`]) query.set(`${only}_cursor`, lists[`${only}_cursor`]!);
    try {
      const next = await api<CatalogData>('/account/data?' + query, { signal: controller.signal });
      if (sequence !== requestSequence) return;
      if (!only) lists = next;
      else lists = { ...lists, [only]: [...lists[only], ...next[only]], [`${only}_total`]: next[`${only}_total`], [`${only}_cursor`]: next[`${only}_cursor`] };
    } catch (error) {
      if (sequence === requestSequence && !(error instanceof DOMException && error.name === 'AbortError')) message(errorMessage(error), 'err');
    } finally { if (sequence === requestSequence) loading = false; }
  }
  function search() {
    clearTimeout(timer);
    requestSequence++; controller?.abort();
    timer = setTimeout(() => refresh(), 200);
  }
  function resetStage() {
    stageSequence++; staged = null; stagePassword = ''; stageWritePassword = ''; stageAccessOpen = false; conflictSlug = ''; overwriteSlug = ''; stageNote = '';
  }
  async function choose(files: File[], entries: FileSystemEntry[] = [], folder = false) {
    if (busy) return;
    const sequence = ++stageSequence; busy = true;
    try {
      const next = await stageFiles(files, entries, folder);
      if (sequence !== stageSequence || !next) return;
      if (!next.files.length) throw new Error('That folder is empty. Choose a folder containing files.');
      staged = next; stagePassword = ''; stageWritePassword = ''; stageAccessOpen = false; conflictSlug = ''; overwriteSlug = ''; stageNote = '';
      await tick();
      document.getElementById(next.kind === 'loose' ? 'stage-filename' : 'stage-slug')?.focus();
      if (next.kind !== 'loose') {
        const preferred = next.slug;
        try {
          const available = await firstFreeSlug(preferred, contentOrigin, handle);
          if (sequence === stageSequence && staged?.slug === preferred) {
            staged.slug = available;
            if (available !== preferred) stageNote = `'${preferred}' exists. Using '${available}'.`;
          }
        } catch { /* Creation still checks collisions atomically if the public lookup fails. */ }
      }
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
    const overwrite = overwriteSlug === upload.slug;
    try {
      const result = await publish(upload, { password: stagePassword.trim(), write_password: stageWritePassword.trim(), ttl: stageTtl, write_policy: stageWrite, overwrite });
      message('Published', 'ok', { ...result, password: result.password || stagePassword.trim() || undefined, write_password: result.write_password || stageWritePassword.trim() || undefined });
      resetStage(); await refresh();
    } catch (error) {
      if (upload.kind !== 'loose' && isCollision(error) && !overwrite) {
        if (conflictSlug === upload.slug) {
          overwriteSlug = upload.slug;
          stageNote = `'${upload.slug}' exists. Choose “Write into it” to update the existing site. Other paths stay.`;
        } else {
          conflictSlug = upload.slug;
          try {
            const suggested = await firstFreeSlug(nextNumberedSlug(upload.slug), contentOrigin, handle);
            stageNote = `'${upload.slug}' exists. Using '${suggested}'. Publish to create it, or put '${upload.slug}' back to write into the existing site.`;
            staged.slug = suggested;
          } catch (lookupError) { message(errorMessage(lookupError), 'err'); }
        }
      } else { message(errorMessage(error), 'err'); await refresh(); }
    } finally { busy = false; publishing = false; }
  }
  function selectTarget(kind: 'site' | 'file', item: CatalogItem) { target = { kind, item }; modalError = ''; }
  function deleteItem(kind: 'site' | 'file', item: CatalogItem) { selectTarget(kind, item); confirmAction = 'Delete'; confirmOpen = true; }
  function editPassword(kind: 'site' | 'file', item: CatalogItem) {
    selectTarget(kind, item);
    password = '';
    writePassword = '';
    shareMode = 'unchanged';
    writeMode = 'unchanged';
    passwordOpen = true;
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
    try {
      duplicateSlug = await firstFreeSlug(nextNumberedSlug(target.item.slug ?? target.item.id), contentOrigin, handle);
      confirmAction = 'Duplicate'; confirmOpen = true;
    } catch (error) { message(errorMessage(error), 'err'); }
  }
  async function confirm(value: string) {
    if (!target) return;
    await mutate(async () => {
      if (confirmAction === 'Delete') { await api(targetPath, { method: 'DELETE' }); message(`Deleted ${targetName}.`); }
      else message('Duplicated', 'ok', await api<PublishResult>('/account/sites', jsonBody('POST', { slug: slugify(value), duplicate_from: target!.item.slug })));
      confirmOpen = false;
    });
  }
  async function saveLinkAccess() {
    if (!target || !linkAccessReady) return;
    const body: Record<string, unknown> = {};
    if (shareMode === 'remove') body.password = '';
    else if (shareMode === 'replace' && password.trim()) body.password = password.trim();
    if (isTargetCreator) {
      if (writeMode === 'remove') body.write_password = '';
      else if (writeMode === 'replace' && writePassword.trim()) body.write_password = writePassword.trim();
    }
    if (!Object.keys(body).length) return;
    await mutate(async () => {
      const result = await api<PublishResult>(targetPath, jsonBody('PATCH', body));
      const bits: string[] = [];
      if ('password' in body) bits.push(result.password_protected ? `Share password set for ${targetName}.` : `Share password removed from ${targetName}.`);
      if ('write_password' in body) bits.push(result.write_password_protected ? `Write password set for ${targetName}.` : `Write password removed from ${targetName}.`);
      message(bits.join(' ') || 'Link access updated.', 'ok', { url: '', password: result.password, write_password: result.write_password });
      passwordOpen = false; password = ''; writePassword = ''; shareMode = 'unchanged'; writeMode = 'unchanged';
    });
  }
  async function saveWrite() {
    await mutate(async () => { await api(targetPath, jsonBody('PATCH', { write_policy: write })); message('Who can write updated.'); writeOpen = false; });
  }
  const moreItems = $derived(target ? [
    ...(target.kind === 'file' || (target.item.file_count ?? 0) > 0 ? [{ label: target.kind === 'site' ? 'Download zip' : 'Download', icon: 'download' as const, href: `${targetPath}/${target.kind === 'site' ? 'export' : 'download'}` }] : []),
    { label: 'Duplicate', icon: 'fork' as const, onClick: duplicate },
    { label: target.item.password_protected || target.item.write_password_protected ? 'Change or remove password' : 'Set password', icon: 'lock' as const, onClick: () => { password = ''; writePassword = ''; shareMode = 'unchanged'; writeMode = 'unchanged'; passwordOpen = true; } },
    ...(target.item.created_by === data.email ? [{ label: 'Who can write', icon: 'person' as const, onClick: () => { write = target!.item.write_policy; writeOpen = true; } }] : []),
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
</script>

<main class="en-wrap">
  <PageTitle wide title="Publish a document, prototype, or file."><p class="en-lede">Upload here and get a link. Or <a href="/setup">connect your agent</a> to publish for you.</p></PageTitle>
  <div id="messages" class="en-hub-messages">{#each messages as item}<Flash tone={item.tone} password={item.password} writePassword={item.writePassword}>{item.text}{#if item.url} <a href={item.url}>{item.name}</a>{/if}</Flash>{/each}</div>
  <div class="en-space-after"><Card charged tight>
    <DropZone over={dragDepth > 0} {busy} onFiles={() => filepick.click()} onFolder={() => folderpick.click()} children={staged ? stage : undefined} />
    <input bind:this={filepick} id="filepick" class="en-sr-only" type="file" multiple onchange={e => picked(e)} />
    <input bind:this={folderpick} id="folderpick" class="en-sr-only" type="file" webkitdirectory onchange={e => picked(e, true)} />
  </Card></div>
  <div class="en-stack en-space-after">
    <Card title="Sites" hint={`${lists.sites.length < lists.sites_total ? `${lists.sites.length} of ` : ''}${lists.sites_total} ${lists.sites_total === 1 ? 'site' : 'sites'}`} tight>
      <div class="en-card-body en-toolbar"><Input size="md" id="q" class="en-search" type="search" placeholder="Search slugs and filenames" aria-label="Search slugs and filenames" bind:value={q} oninput={search} />
        <SegmentedControl id="scope" bind:value={scope} ariaLabel="Catalog scope" onChange={() => refresh()} options={[{ value: 'involved', label: 'Your work' }, { value: 'created', label: 'Created by you' }, { value: 'edited', label: 'Last edited by you' }]} />
        <Select id="sort" aria-label="Sort" bind:value={sort} onchange={() => refresh()} options={[{ value: 'updated', label: 'Updated' }, { value: 'name', label: 'Name' }]} />
      </div>
      <div id="sites"><Catalog kind="site" items={lists.sites} cursor={lists.sites_cursor} busy={loading} allowUnlimited={data.policy.allow_unlimited} writePolicyDefault={data.policy.write_policy} onMore={item => openMore('site', item)} onPassword={item => editPassword('site', item)} onDelete={item => deleteItem('site', item)} onLoadMore={() => refresh('sites')} /></div>
    </Card>
    <Card title="Files" hint={`${lists.files.length < lists.files_total ? `${lists.files.length} of ` : ''}${lists.files_total} ${lists.files_total === 1 ? 'file' : 'files'}`} tight>
      <div id="files"><Catalog kind="file" items={lists.files} cursor={lists.files_cursor} busy={loading} allowUnlimited={data.policy.allow_unlimited} writePolicyDefault={data.policy.write_policy} onMore={item => openMore('file', item)} onPassword={item => editPassword('file', item)} onDelete={item => deleteItem('file', item)} onLoadMore={() => refresh('files')} /></div>
    </Card>
  </div>
  <p class="en-lede">Your catalog includes work you created or last edited. To revise an existing file at the same link, ask your agent to update it; uploading it here creates a new file. Links show current contents until expiry or deletion.</p>
</main>

{#snippet stage()}{#if staged}
  <form id="stage" class="en-stage" onsubmit={launch}>
    <div class="en-stage-status" id="stage-status"><Unit size={5} />{staged.kind === 'loose' ? '1 file ready' : `${staged.files.length} ${staged.files.length === 1 ? 'file' : 'files'} ready`}</div>
    {#if staged.kind === 'loose'}<div id="stage-loose"><Field label="URL" htmlFor="stage-filename"><UrlField id="stage-filename" ariaLabel="Filename" prefix={`${contentOrigin}/${handle}/f/{id}/`} bind:value={staged.filename} disabled={busy} /></Field></div>
    {:else}<div id="stage-site"><Field label="URL" htmlFor="stage-slug"><UrlField id="stage-slug" ariaLabel="Site slug" prefix={`${contentOrigin}/${handle}/s/`} suffix="/" bind:value={staged.slug} disabled={busy} oninput={() => { overwriteSlug = ''; }} /></Field></div>{/if}
    {#if stageNote}<p id="stage-exists" class="en-stage-exists">{stageNote}</p>{/if}
    <Field label="Expiration" htmlFor="stage-ttl" noteId="stage-ttl-note" note={ttlNote}><Select id="stage-ttl" aria-label="When this expires" options={ttlOptions} bind:value={stageTtl} disabled={busy} /></Field>
    <Field label="Who can write" htmlFor="stage-write" note="Controls who with a token can update or delete this work. It does not grant or deny the write-password door."><Select id="stage-write" aria-label="Who can write" options={writeOptions} bind:value={stageWrite} disabled={busy} /></Field>
    <details id="stage-access" class="en-stage-access" bind:open={stageAccessOpen}>
      <summary>Link access</summary>
      <Field label="Share password" htmlFor="stage-password" noteId="stage-password-note" note="Leave empty so anyone with the link can open it. Valid API tokens on this instance can read the work even with a share password."><PasswordField id="stage-password" generateId="stage-pw-gen" copyId="stage-pw-copy" words={data.words} bind:value={stagePassword} describedby="stage-password-note" disabled={busy} /></Field>
      <Field label="Write password" htmlFor="stage-write-password" noteId="stage-write-password-note" note={staged.kind === 'loose' ? 'Replaces this file only. Leave empty to keep guests from writing.' : 'Full control of served bytes, including replacing index.html. Leave empty to keep guests from writing.'}><PasswordField id="stage-write-password" generateId="stage-wpw-gen" copyId="stage-wpw-copy" words={data.words} bind:value={stageWritePassword} describedby="stage-write-password-note" disabled={busy} /></Field>
    </details>
    <div class="en-stage-actions"><Button id="stage-cancel" onclick={resetStage} disabled={busy}>Cancel</Button><Button type="submit" id="stage-go" variant="primary" disabled={busy}>{publishing ? 'Publishing…' : busy ? 'Preparing…' : overwriteSlug === staged.slug ? 'Write into it' : 'Publish'}</Button></div>
  </form>
{/if}{/snippet}

<Sheet bind:open={moreOpen} title={targetName} meta={target ? `${target.kind === 'site' ? 'Site' : 'File'} · ${target.item.write_policy === 'instance' ? 'Anyone with a token on this host.' : 'Only the creator'}` : ''} items={moreItems} />
<ConfirmDialog bind:open={confirmOpen} title={`${confirmAction} ${target?.kind || 'site'}`} message={confirmAction === 'Delete' ? `This removes the ${target?.kind} and its bytes. There is no recycle bin. Type the name to confirm.` : 'Creates a new site you own. Expiration starts now. The share password and write password are not copied.'}
  label={confirmAction === 'Delete' ? `Type “${targetName}” to delete` : 'New slug'} initial={confirmAction === 'Duplicate' ? duplicateSlug : ''} match={confirmAction === 'Delete' ? targetName : undefined} action={confirmAction} danger={confirmAction === 'Delete'} busy={mutationBusy} onConfirm={confirm} error={modalError} />
<Dialog dismissible={!mutationBusy} id="pw-dlg" bind:open={passwordOpen} title="Link access" message="Each secret is independent. An empty box does not change the other. Energon only stores hashes; copy a new phrase now.">
  {#if modalError}<Flash tone="err">{modalError}</Flash>{/if}
  <form onsubmit={e => { e.preventDefault(); void saveLinkAccess(); }}>
    <Field label="Share password" htmlFor="pw-dlg-input" noteId="pw-dlg-note" note="Anyone with this password can open the link. Valid API tokens on this instance can still read the work.">
      <SegmentedControl id="pw-dlg-share-mode" ariaLabel="Share password action" bind:value={shareMode} options={shareModes} />
      {#if shareMode === 'replace'}<PasswordField id="pw-dlg-input" generateId="pw-dlg-gen" copyId="pw-dlg-copy" describedby="pw-dlg-note" words={data.words} bind:value={password} disabled={mutationBusy} />{/if}
    </Field>
    {#if isTargetCreator}
      <Field label="Write password" htmlFor="pw-dlg-write-input" noteId="pw-dlg-write-note" note={writePasswordNote}>
        <SegmentedControl id="pw-dlg-write-mode" ariaLabel="Write password action" bind:value={writeMode} options={writeModes} />
        {#if writeMode === 'replace'}<PasswordField id="pw-dlg-write-input" generateId="pw-dlg-write-gen" copyId="pw-dlg-write-copy" describedby="pw-dlg-write-note" words={data.words} bind:value={writePassword} disabled={mutationBusy} />{/if}
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
<div id="drop-overlay" class="en-drop-overlay" hidden={dragDepth === 0} aria-hidden={dragDepth === 0}><div class="en-drop-overlay-frame"><div class="en-drop-title">Drop to stage</div><div class="en-drop-sub">A folder or zip becomes a site. One file gets a stable URL. Nothing is written until you Publish.</div></div></div>
