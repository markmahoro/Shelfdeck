# UAT-319 CIFS重挂载身份稳定性

2026-10-13用户要求NAS重启后重启ShelfDeck与MoviePilot，并在确认启动阻塞原因后明确要求修复。MoviePilot页面HTTP200；ShelfDeck版本505844a8b重启后容器内/media及/adult_media恢复CIFS，但启动HELIX_MOUNT_SCOPE_UNSAFE。

只读核对两个Field及两个Shelf的当前reference，endpoint、mount boundary、filesystem type、inode能力digest相同；仅stable fingerprint/probe digest不匹配。使用相同Media source/root/type与旧deviceIdentity=0:93重算，精确命中原Registry；当前deviceIdentity=0:81。诊断时验证旧设备号，正式纠正工具必须显式输入该值，不允许在启动中猜测。

修复限定Platform：CIFS evidence@2移除临时major:minor，保留server/share source、共享内root及filesystem type；其他filesystem仍用原算法。本次没有更改业务Owner、Handoff、Material Control或资源调度。SSOT §7.6.1补明确派生证据纠正合同。已有Platform记录通过独立工具dry run/显式apply和CAS纠正两个错误digest；旧完整证据、endpoint/boundary/type/inode能力及当前revision必须匹配，保留Scope ID/revision/effective time。正常启动仍不写纠正数据。resolveRoot按已注册的稳定fingerprint复用opaque Scope ID，拒绝重复fingerprint。

验收：设备号多次变化保持Scope；共享server/share/root变化拒绝；错误旧设备号、stale revision及证据冲突拒绝；dry run不写、apply幂等，历史业务记录不改。受影响Windows专项当前17项通过。尚未完成精确Linux镜像、最新生产副本与生产恢复，不关闭。五项失败媒体不重处理、没有Reset或删除媒体。
