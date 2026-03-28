# 合一漫剧远程授权校验方案

这套方案的目标是：

- 保留现有本地机器码生成与授权文件缓存
- 将“激活码是否合法”切换到远程服务判定
- 支持离线回退策略，避免服务短时故障导致全部失效

## 1. 当前客户端行为

客户端仍然保留以下本地逻辑：

- 机器码生成：`CPU + 磁盘序列号 + 物理网卡 MAC`
- 本地授权文件：`%LOCALAPPDATA%\\FEICAI-Studio\\.license`
- 授权状态缓存：进程内 `5 分钟`

远程校验启用后，客户端只把这两类信息发给远程服务：

- `activationCode`
- `machineCodes`（候选机器码数组）

## 2. 启用方式

在客户端环境变量中配置：

```env
FEICAI_LICENSE_REMOTE_URL=https://license.example.com/api/verify
FEICAI_LICENSE_REMOTE_APP_ID=aiheyi-desktop
FEICAI_LICENSE_REMOTE_SHARED_SECRET=replace-with-a-strong-secret
FEICAI_LICENSE_REMOTE_TIMEOUT_MS=15000
FEICAI_LICENSE_REMOTE_FALLBACK_LOCAL=1
```

说明：

- `FEICAI_LICENSE_REMOTE_URL`
  - 远程授权校验接口地址
- `FEICAI_LICENSE_REMOTE_APP_ID`
  - 客户端应用标识，方便多产品共用同一授权服务
- `FEICAI_LICENSE_REMOTE_SHARED_SECRET`
  - 可选。用于给请求体做 HMAC 签名
- `FEICAI_LICENSE_REMOTE_TIMEOUT_MS`
  - 超时时间，默认 `15000`
- `FEICAI_LICENSE_REMOTE_FALLBACK_LOCAL`
  - 设为 `1` 后，远程服务不可达时会回退到本地校验

## 3. 请求协议

请求方式：

- `POST /api/verify`
- `Content-Type: application/json`

请求头：

```http
x-license-app-id: aiheyi-desktop
x-license-timestamp: 2026-03-24T10:00:00.000Z
x-license-nonce: 550e8400-e29b-41d4-a716-446655440000
x-license-signature: <optional hex hmac>
```

请求体：

```json
{
  "appId": "aiheyi-desktop",
  "activationCode": "9FE8-9E86-4FDA-F7CD-9421-99991231",
  "machineCodes": [
    "F263-F4AB-7249-CF04",
    "A111-B222-C333-D444"
  ],
  "timestamp": "2026-03-24T10:00:00.000Z",
  "nonce": "550e8400-e29b-41d4-a716-446655440000"
}
```

## 4. 签名规则

如果配置了 `FEICAI_LICENSE_REMOTE_SHARED_SECRET`，客户端会发送：

- `x-license-signature`

签名原文：

```text
${timestamp}.${nonce}.${rawJsonBody}
```

签名算法：

- `HMAC-SHA256`
- 输出为十六进制小写字符串

服务端应使用同一密钥做校验。

## 5. 响应协议

成功响应：

```json
{
  "valid": true,
  "matchedMachineCode": "F263-F4AB-7249-CF04",
  "expiry": "2099-12-31",
  "daysLeft": 9999
}
```

失败响应：

```json
{
  "valid": false,
  "reason": "invalid",
  "error": "激活码无效，请检查是否输入正确"
}
```

支持的 `reason`：

- `invalid`
- `expired`
- `mismatch`
- `error`

过期响应示例：

```json
{
  "valid": false,
  "reason": "expired",
  "matchedMachineCode": "F263-F4AB-7249-CF04",
  "expiry": "2026-12-31",
  "daysLeft": -5,
  "error": "授权已过期"
}
```

## 6. 推荐服务端逻辑

推荐远程服务按以下顺序处理：

1. 校验 `timestamp` 是否在允许窗口内，例如 `5 分钟`
2. 校验 `nonce` 是否重复，防止重放
3. 校验 `x-license-signature`
4. 根据 `activationCode` 查询数据库或授权表
5. 判断是否绑定到请求中的任一 `machineCode`
6. 判断是否过期
7. 返回标准化结果

推荐数据库字段：

- `activation_code`
- `machine_code`
- `license_state`
- `expires_at`
- `customer_name`
- `notes`
- `last_check_at`
- `last_check_machine_code`

## 7. 回退策略

推荐两种模式：

- 生产严格模式
  - 不配置 `FEICAI_LICENSE_REMOTE_FALLBACK_LOCAL`
  - 远程服务失败即授权失败
- 运维稳态模式
  - 配置 `FEICAI_LICENSE_REMOTE_FALLBACK_LOCAL=1`
  - 远程服务挂掉时，暂时按本地签名逻辑兜底

如果你准备逐步切换，建议先用第二种。

## 8. 本地联调

仓库附带一个 mock 远程服务：

```bat
cd /d H:\\as\\aiheyi
node scripts/mock-remote-license-server.cjs
```

再配置：

```env
FEICAI_LICENSE_REMOTE_URL=http://127.0.0.1:8787/api/verify
FEICAI_LICENSE_REMOTE_SHARED_SECRET=FEICAI-STUDIO-SOURCE-AUTH-2026
FEICAI_LICENSE_REMOTE_FALLBACK_LOCAL=1
```

## 9. 建议上线顺序

1. 先上线远程服务
2. 用 mock 和真实服务分别联调
3. 客户端启用远程校验 + 本地回退
4. 稳定后再关闭本地回退
