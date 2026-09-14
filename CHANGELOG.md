# Changelog

## 1.0.0 (2026-09-14)


### Features

* admin cleanup across every account ([#69](https://github.com/tmchow/energon/issues/69)) ([f0c1cb4](https://github.com/tmchow/energon/commit/f0c1cb477d0889ff250604c88af6e401929dd1ee))
* **admin:** list and revoke API tokens across accounts ([#73](https://github.com/tmchow/energon/issues/73)) ([10f601f](https://github.com/tmchow/energon/commit/10f601f6c7c1746361186bdaf8b99824a518e609))
* connect agents with human-approved token delivery ([#52](https://github.com/tmchow/energon/issues/52)) ([dae6631](https://github.com/tmchow/energon/commit/dae6631e35d11c5ea47bae546fb310578baaa22f))
* expire API tokens after a lifetime chosen at mint ([#36](https://github.com/tmchow/energon/issues/36)) ([570358c](https://github.com/tmchow/energon/commit/570358c5ba8439a2fa30213f2b6efec422785a41))
* generate instance plugin catalogs on skill:init ([0a5cdc0](https://github.com/tmchow/energon/commit/0a5cdc0a2b3fd4971e55af0659dffc0fe78cb19d))
* **hub:** apply polished motion to existing controls ([#100](https://github.com/tmchow/energon/issues/100)) ([70d3c0b](https://github.com/tmchow/energon/commit/70d3c0b813975b3a382bf9b11a79ade86d867a3b))
* **hub:** carry the ambient particle field into the app ([#92](https://github.com/tmchow/energon/issues/92)) ([1d6e01e](https://github.com/tmchow/energon/commit/1d6e01e732f8522032fd6cee4e66ee67940e7610))
* **hub:** change expiration from the catalog ([#64](https://github.com/tmchow/energon/issues/64)) ([e9719b9](https://github.com/tmchow/energon/commit/e9719b9903b0dcf7d97823699527dc43db18817a))
* **hub:** one catalog for sites and files with a floating cleanup bar ([#98](https://github.com/tmchow/energon/issues/98)) ([9c7d023](https://github.com/tmchow/energon/commit/9c7d0231bad3473d942349ac64088a487e9eb5e0))
* make agent authentication discoverable ([#51](https://github.com/tmchow/energon/issues/51)) ([3e81a33](https://github.com/tmchow/energon/commit/3e81a33515ceed96a1d3fdd70ee97580812d9116))
* make the code-based connection the default agent path ([#57](https://github.com/tmchow/energon/issues/57)) ([fc1be15](https://github.com/tmchow/energon/commit/fc1be15703ad18b967f6fd607bca68083ce6a802))
* **md:** render documents without app chrome ([#103](https://github.com/tmchow/energon/issues/103)) ([0395beb](https://github.com/tmchow/energon/commit/0395beb779b1bcab01ed08fbd3c33949bba92b0f))
* **v1:** export owned sites and files as one zip ([#72](https://github.com/tmchow/energon/issues/72)) ([4fe3471](https://github.com/tmchow/energon/commit/4fe3471e67d55f5defa8e17133a97558688f4d83))
* **v1:** publish OpenAPI 3.1 contract ([#47](https://github.com/tmchow/energon/issues/47)) ([f2a1d4b](https://github.com/tmchow/energon/commit/f2a1d4bfd898d9ac8b321e4175287c08684a2e8f))
* **v1:** self-service cleanup ([#65](https://github.com/tmchow/energon/issues/65)) ([99a39d0](https://github.com/tmchow/energon/commit/99a39d037f3580342f92b72e0a72956d8769164d))


### Bug Fixes

* apply the Energon design system across the Svelte UI ([#55](https://github.com/tmchow/energon/issues/55)) ([f014320](https://github.com/tmchow/energon/commit/f0143208bf98e2b3217e42bb6c1509eea329f8a1))
* **auth:** recognize hostname Access sessions ([#93](https://github.com/tmchow/energon/issues/93)) ([f345b7a](https://github.com/tmchow/energon/commit/f345b7a319b617ed034f34812532da860ed0fd82))
* **ci:** grant release-please issues write for labels ([#106](https://github.com/tmchow/energon/issues/106)) ([3b1fc20](https://github.com/tmchow/energon/commit/3b1fc201cd377564776d70b36b14fbb4b2e409be))
* contain skill initialization paths ([#9](https://github.com/tmchow/energon/issues/9)) ([7c4f7b9](https://github.com/tmchow/energon/commit/7c4f7b9da5b384ef120e6071cdfa67e481e1497d))
* enforce zip import resource limits ([#5](https://github.com/tmchow/energon/issues/5)) ([8e7fd69](https://github.com/tmchow/energon/commit/8e7fd69fc6429776fe0ffcbf19d499584e0e948e))
* harden mutation integrity and request decoding ([#28](https://github.com/tmchow/energon/issues/28)) ([2a55c91](https://github.com/tmchow/energon/commit/2a55c910580cac4ece3ab2612a95ed95ec143d05))
* honor configured token prefixes ([#8](https://github.com/tmchow/energon/issues/8)) ([71333a8](https://github.com/tmchow/energon/commit/71333a817b1eaac53fe958cb5992e5c021ea304a))
* **hub:** close keyboard and screen reader gaps, validate filters ([#89](https://github.com/tmchow/energon/issues/89)) ([ae6bcc4](https://github.com/tmchow/energon/commit/ae6bcc4a2b105d063f0d358d45da12bab0f4bdd3))
* **install:** clarify inventory permissions and agent discovery ([#104](https://github.com/tmchow/energon/issues/104)) ([c89af37](https://github.com/tmchow/energon/commit/c89af374d0c45106cf087ae8a53038108aa3424c))
* **install:** configure access through a resumable api command ([#97](https://github.com/tmchow/energon/issues/97)) ([33e8681](https://github.com/tmchow/energon/commit/33e8681b81427f30b15a030e8a3e9515ec0474f8))
* **install:** verify existing access before upgrading forks ([#101](https://github.com/tmchow/energon/issues/101)) ([e173ddc](https://github.com/tmchow/energon/commit/e173ddc301f4af31722fb1ad6a13366257465eec))
* isolate published content from the authenticated hub ([#7](https://github.com/tmchow/energon/issues/7)) ([c355ef7](https://github.com/tmchow/energon/commit/c355ef78b8614cb1013db3456663cdafad302dd1))
* keep the Hub title on two lines and shorten its lede ([#58](https://github.com/tmchow/energon/issues/58)) ([b03d060](https://github.com/tmchow/energon/commit/b03d06099093ed9e662276b5452a229c7f99f64b))
* limit fork PR declines to canonical repository ([#11](https://github.com/tmchow/energon/issues/11)) ([801f87b](https://github.com/tmchow/energon/commit/801f87bc3760ac4eea16ff3118584dcb253d3fbf))
* **markdown:** link branding to the public homepage ([#95](https://github.com/tmchow/energon/issues/95)) ([d608f9b](https://github.com/tmchow/energon/commit/d608f9b81f7c787bf4b1b4d543a270fc30ed5344))
* order legacy schema upgrades before indexes ([#6](https://github.com/tmchow/energon/issues/6)) ([ac18e5d](https://github.com/tmchow/energon/commit/ac18e5dbd57669f4bbe9e691771dba0aae3faae8))
* preserve D1/R2 state across failed mutations ([#40](https://github.com/tmchow/energon/issues/40)) ([b08e397](https://github.com/tmchow/energon/commit/b08e3971ddad1e724a38bdd3957c7f6b56185a95))
* preserve site storage integrity across mutations ([#10](https://github.com/tmchow/energon/issues/10)) ([dc996ce](https://github.com/tmchow/energon/commit/dc996cead5074f0d68e2c54e9ca2517b5656c4e9))
* require instance setup before distributing a plugin ([#53](https://github.com/tmchow/energon/issues/53)) ([e91e3b0](https://github.com/tmchow/energon/commit/e91e3b00b2ee9d7bc4b04a2ba9bbbcfd2a697671))
* **security:** fail closed on cache purge and reserve storage atomically ([c45e1d3](https://github.com/tmchow/energon/commit/c45e1d36de016e12a3608df67df8185724d14add)), closes [#16](https://github.com/tmchow/energon/issues/16) [#19](https://github.com/tmchow/energon/issues/19) [#20](https://github.com/tmchow/energon/issues/20) [#22](https://github.com/tmchow/energon/issues/22)
* **security:** hash-only tokens, IdP identity, and gate limits ([cd82cc6](https://github.com/tmchow/energon/commit/cd82cc66df5345e52a2d51322f1d3b19e631965c)), closes [#17](https://github.com/tmchow/energon/issues/17) [#18](https://github.com/tmchow/energon/issues/18) [#21](https://github.com/tmchow/energon/issues/21)
* **security:** isolate published HTML and harden hub mutations ([7005af6](https://github.com/tmchow/energon/commit/7005af68e8eb297e7119d392e747bccafeaecee1))
* serialize loose-file replacement with expiry purge ([#12](https://github.com/tmchow/energon/issues/12)) ([98c0aad](https://github.com/tmchow/energon/commit/98c0aadab29b1ca11dfdf2df79254b63ad9086a7))
* **skill:** correct publishing methods and content URLs ([#96](https://github.com/tmchow/energon/issues/96)) ([8afb90c](https://github.com/tmchow/energon/commit/8afb90c1f7149de9d4b232b69e56e5ed8713ccd8))
* **test:** isolate fixtures from fork settings ([#94](https://github.com/tmchow/energon/issues/94)) ([6db033f](https://github.com/tmchow/energon/commit/6db033f019d4af3750dd0a5a83641b7c9edf4334))
* **verify:** honor fork identity policy ([#102](https://github.com/tmchow/energon/issues/102)) ([217a8a1](https://github.com/tmchow/energon/commit/217a8a1908d4e8b53af4df7762c54e15807dd9b4))


### Performance

* avoid recompressing compressed ZIP assets ([#44](https://github.com/tmchow/energon/issues/44)) ([750a9da](https://github.com/tmchow/energon/commit/750a9da7c2be696e1ca5306dd1049181a073694c))
* speed up large site imports ([#39](https://github.com/tmchow/energon/issues/39)) ([9658d8d](https://github.com/tmchow/energon/commit/9658d8d79627265b031b95187babb2b6797a780a))

## Changelog
