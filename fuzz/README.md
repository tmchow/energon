# ZIP fuzzing

`npm run fuzz:regression` replays the committed seed corpus. CI runs it on every pull request.

`npm run fuzz:zip` starts a local coverage-guided campaign. Pass libFuzzer options after the script to bound a run:

```bash
npm run fuzz:zip -- -max_total_time=60
```

The campaign keeps coverage-producing inputs in `fuzz/corpus/zip/`; generated hash-named entries are ignored by Git. Crashes are written to `fuzz/artifacts/zip/`.

Minimize a crash before debugging it. Add the minimized input to the committed corpus and a focused unit regression test with the fix.
