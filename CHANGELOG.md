# Changelog

## [1.13.0](https://github.com/tmchow/energon/compare/v1.12.0...v1.13.0) (2026-10-08)


### Features

* **hub:** call agent credentials keys and move /tokens to /keys ([#155](https://github.com/tmchow/energon/issues/155)) ([525edc9](https://github.com/tmchow/energon/commit/525edc9410c54da2223b98c318c4137d32ac76a9))

## [1.12.0](https://github.com/tmchow/energon/compare/v1.11.0...v1.12.0) (2026-10-08)


### Features

* **api:** readable deployment operationIds and content-origin servers ([#152](https://github.com/tmchow/energon/issues/152)) ([6e32895](https://github.com/tmchow/energon/commit/6e3289536f41435c0a8be44b6227aeca995b1967))
* **skill:** serve the skill to gateways and ship an upload helper ([#153](https://github.com/tmchow/energon/issues/153)) ([615ee58](https://github.com/tmchow/energon/commit/615ee5832f876fd8a9cd9d47dd181b1ef1f0d99d))

## [1.11.0](https://github.com/tmchow/energon/compare/v1.10.0...v1.11.0) (2026-10-08)


### Features

* **files:** reject stale loose-file replacements with expected_version ([#150](https://github.com/tmchow/energon/issues/150)) ([6ff1203](https://github.com/tmchow/energon/commit/6ff12031e94dee763eb2c525e2348d0e9e32e4fc))


### Bug Fixes

* **files:** return file_recovery_required for files blocked on storage recovery ([#149](https://github.com/tmchow/energon/issues/149)) ([9dba861](https://github.com/tmchow/energon/commit/9dba86184ae3b6d35c4879220e752c840a5eb1f8))


### Performance

* **sites:** convert legacy sites in budgeted batches ([#147](https://github.com/tmchow/energon/issues/147)) ([bfc76ff](https://github.com/tmchow/energon/commit/bfc76ff8dbf885cbef47fe260fbf519c0d783213))

## [1.10.0](https://github.com/tmchow/energon/compare/v1.9.0...v1.10.0) (2026-10-07)


### Features

* **grants:** set share passwords at mint and return result_id on recovery ([#139](https://github.com/tmchow/energon/issues/139)) ([c2f9d31](https://github.com/tmchow/energon/commit/c2f9d31170ed377b22acb78f2c7b10fd6fff95f2))
* **sites:** publish complete site updates atomically ([#145](https://github.com/tmchow/energon/issues/145)) ([cef60de](https://github.com/tmchow/energon/commit/cef60de47e96fd841a2725b33100c3f1b9c8c617))

## [1.9.0](https://github.com/tmchow/energon/compare/v1.8.0...v1.9.0) (2026-10-07)


### Features

* **grants:** let a tokenless machine upload one file with a single-use grant ([#137](https://github.com/tmchow/energon/issues/137)) ([fb74aae](https://github.com/tmchow/energon/commit/fb74aaeabcf27ba49687d647714afd20f83995fa))


### Bug Fixes

* **content:** sandbox published XML like HTML and SVG ([#135](https://github.com/tmchow/energon/issues/135)) ([d1216b7](https://github.com/tmchow/energon/commit/d1216b780aaa6db5f207dd7f1396979c66eb1a5d))

## [1.8.0](https://github.com/tmchow/energon/compare/v1.7.0...v1.8.0) (2026-10-06)


### Features

* raise default file upload cap to 100 MB with a separate 25 MB zip cap ([#132](https://github.com/tmchow/energon/issues/132)) ([43fef4e](https://github.com/tmchow/energon/commit/43fef4e25f88a031aa8e79f31685ae899658bf19))

## [1.7.0](https://github.com/tmchow/energon/compare/v1.6.0...v1.7.0) (2026-09-16)


### Features

* **hub:** expiring-soon presets and urgency on Expires column ([#127](https://github.com/tmchow/energon/issues/127)) ([6afab4c](https://github.com/tmchow/energon/commit/6afab4c1520147a7175b56436b3b11eee5c432e3))
* **hub:** sort catalog by last read and filter changed since last open ([#128](https://github.com/tmchow/energon/issues/128)) ([18f409a](https://github.com/tmchow/energon/commit/18f409a1255b925b9d505497b2bf236469465810))


### Bug Fixes

* **md:** raise mermaid diagram contrast in light and dark ([#129](https://github.com/tmchow/energon/issues/129)) ([6388cff](https://github.com/tmchow/energon/commit/6388cff3daa72f7f1a7b3babe9c9465ecd2f815c))
* **verify:** mint a matching file for hub catalog paging ([#131](https://github.com/tmchow/energon/issues/131)) ([4b05992](https://github.com/tmchow/energon/commit/4b05992b6049951c8a3c150337d1cdbca1a716ea))

## [1.6.0](https://github.com/tmchow/energon/compare/v1.5.0...v1.6.0) (2026-09-15)


### Features

* **connect:** confirm the agent code from the verification link ([#123](https://github.com/tmchow/energon/issues/123)) ([b991ce2](https://github.com/tmchow/energon/commit/b991ce2b41c25eccccd2ca85ee66700a482a2a34))

## [1.5.0](https://github.com/tmchow/energon/compare/v1.4.0...v1.5.0) (2026-09-15)


### Features

* **setup:** advertise npx skills add install ([#109](https://github.com/tmchow/energon/issues/109)) ([2a2b626](https://github.com/tmchow/energon/commit/2a2b62635224317fda8a0132045823d3ae72641e))


### Bug Fixes

* **hub:** stop blocking paint on Google Fonts import ([#120](https://github.com/tmchow/energon/issues/120)) ([84dec07](https://github.com/tmchow/energon/commit/84dec0725de834c15ef9db8b11c6702b90396fda))
* **skill:** let generated plugins follow Energon releases ([#122](https://github.com/tmchow/energon/issues/122)) ([9017881](https://github.com/tmchow/energon/commit/9017881d33993bcb537fa368fddbfd79d7bf89a7))

## [1.4.0](https://github.com/tmchow/energon/compare/v1.3.0...v1.4.0) (2026-09-15)


### Features

* **skill:** land routine upstream updates by repository policy ([#117](https://github.com/tmchow/energon/issues/117)) ([4933ee5](https://github.com/tmchow/energon/commit/4933ee551a2032b5f3770aa190fd832cbf718ddd))

## [1.3.0](https://github.com/tmchow/energon/compare/v1.2.0...v1.3.0) (2026-09-15)


### Features

* **skill:** add deploy-this-energon operator skill ([#115](https://github.com/tmchow/energon/issues/115)) ([ecd86c1](https://github.com/tmchow/energon/commit/ecd86c12533e87cc4a840501b3056eba186a8139))

## [1.2.0](https://github.com/tmchow/energon/compare/v1.1.0...v1.2.0) (2026-09-15)


### Features

* **skill:** add fork update and backup operator skills ([#112](https://github.com/tmchow/energon/issues/112)) ([d094239](https://github.com/tmchow/energon/commit/d094239a5181fe93b3e2604e21b95cf9421e2c5d))


### Bug Fixes

* **deploy:** support independent private deployment repositories ([#113](https://github.com/tmchow/energon/issues/113)) ([0d200f3](https://github.com/tmchow/energon/commit/0d200f31249fce3e896fa8e8132f6717d94e486b))

## [1.1.0](https://github.com/tmchow/energon/compare/v1.0.0...v1.1.0) (2026-09-15)


### Features

* **hub:** show when an upstream release is available ([#108](https://github.com/tmchow/energon/issues/108)) ([e42c5c6](https://github.com/tmchow/energon/commit/e42c5c6d690efdab86a947130aaf8a5cec9625c1))

## 1.0.0 (2026-09-14)

Initial public release.
