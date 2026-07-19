# P8-09 Capability Registration Evidence

Status: PASS

七项Libra front-half Capability与P2 manifest逐项一致：`libra.decision.query.resolve@1`、
`libra.decision_basis.commit@1`、`libra.intake.candidate.verify@1`、`libra.intake.material.verify@1`、
`libra.intake.binding.resolve@1`、`libra.intake.accept.commit@1`、`libra.intake.rejection.commit@1`。

注册器只接受精确manifest集合和typed execute port；Owner Scope、Effect Class、package digest或port shape漂移均拒绝。
同步Decision/Control事务未伪装成P4长期Workflow，也未引入startup wiring、HTTP或跨域Store依赖。

机器证据：`p8-libra-capability-registrations.test.js`及`npm run test:helix-libra-front-half` PASS。
