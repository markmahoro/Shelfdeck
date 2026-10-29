# 隔离资格依赖

在此目录执行 `npm ci --ignore-scripts --no-audit --no-fund`，不要在仓库根目录安装。运行资格入口时，将本目录的 `node_modules` 与现有 Service 的 `node_modules` 加入 `NODE_PATH`。这里不修改产品应用的依赖或启动入口。

lock固定USearch2.25.3及4个传递依赖，版本与integrity和已验证NAS归档完全一致；所有integrity又与npm官方registry逐项核对，resolved URL规范为官方地址。禁用安装脚本，使用包内预构建的Linux原生扩展，其实际加载和原始索引读取已在Node20.20.2验证。

模型/数据库独立保留在私有NAS受控目录，不属于npm依赖，不随本目录提交或对外分发。
