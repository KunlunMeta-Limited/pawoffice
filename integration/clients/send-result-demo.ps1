#requires -Version 7.0
<#
模拟业务后端向 PawOffice 推送完整任务与成果快照。
保持 README 的运行方式：npm run dev 和 npm run integration-ui-example。
本脚本仅作为第三个终端里运行的一次性业务数据发送工具。
示例：pwsh -File ./integration/clients/send-result-demo.ps1
      pwsh -File ./integration/clients/send-result-demo.ps1 -ResultStatus verified
      pwsh -File ./integration/clients/send-result-demo.ps1 -DryRun
#>
[CmdletBinding()]
param(
    # 与现有接入客户端一致，使用 PAWOFFICE_URL；默认后端地址为 8765。
    [string] $BaseUrl = $(if ($env:PAWOFFICE_URL) { $env:PAWOFFICE_URL } else { 'http://127.0.0.1:8765' }),
    [string] $ApiKey = $(if ($env:PAWOFFICE_API_KEY) { $env:PAWOFFICE_API_KEY } else { 'pawoffice-demo-key' }),
    [ValidateSet('draft', 'ready', 'verified', 'rejected')]
    [string] $ResultStatus = 'ready',
    [ValidateRange(1, 3)]
    [int] $Round = 3,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$demoTeamId = 'result-powershell-demo'
$demoEndpoint = $BaseUrl.TrimEnd('/') + '/api/pawoffice/messages'
$demoNow = [DateTimeOffset]::Now.ToString('o')
$demoDate = Get-Date -Format 'yyyy-MM-dd'
$demoChanges = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../fixtures/result-file-changes.json') -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
$demoHistory = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../fixtures/result-deliveries.json') -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable

function Send-PawOfficeMessage {
    param([hashtable] $Message)
    $json = $Message | ConvertTo-Json -Depth 40 -Compress
    try {
        $response = Invoke-RestMethod -Uri $demoEndpoint -Method Post `
            -Headers @{ Authorization = "Bearer $ApiKey" } `
            -ContentType 'application/json; charset=utf-8' `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 35
    }
    catch {
        $status = if ($_.Exception.Response) { [int] $_.Exception.Response.StatusCode } else { 0 }
        if ($status -eq 404) {
            throw "消息接口不存在：$demoEndpoint。请保持 README 中的 npm run dev 与 npm run integration-ui-example，并用 -BaseUrl 指定消息后端地址（默认 http://127.0.0.1:8765），而非 Vite 页面地址。"
        }
        if ($status -eq 401) { throw 'API 密钥不匹配。请通过 -ApiKey 传入服务端配置的 PAWOFFICE_API_KEY。' }
        $details = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
        throw "发送失败：$details"
    }
    if ($response.code -notin @(200, 202)) { throw ($response | ConvertTo-Json -Depth 20) }
    return $response
}

$demoSeq = 1
if (-not $DryRun) {
    $directory = Send-PawOfficeMessage @{ type = 'office.read' }
    $existing = @($directory.data.offices | Where-Object { $_.id -eq $demoTeamId })
    if ($existing.Count -gt 0) { $demoSeq = [long] $existing[0].seq + 1 }
}

$demoVerified = $ResultStatus -eq 'verified'
$demoRejected = $ResultStatus -eq 'rejected'
$demoBoardStatus = if ($demoVerified) { 'completed' } elseif ($demoRejected) { 'blocked' } else { 'running' }
$demoProgress = if ($demoVerified) { 100 } else { 92 }
$demoCheckStatus = if ($demoVerified) { 'passed' } elseif ($demoRejected) { 'failed' } else { 'pending' }
$demoVerdict = switch ($ResultStatus) {
    'draft' { '模拟数据：当前为草稿，正在整理测试报告和交付文档。' }
    'ready' { '模拟数据：交付文档已准备好，等待负责人完成上线验收。' }
    'verified' { '模拟数据：所有验收项已通过，可以进入发布安排。' }
    'rejected' { '模拟数据：登录频率限制未通过验收，需要修复后重新提交。' }
}
$demoRisks = if ($demoVerified) { @() } else { @(
    @{ id = 'sms-limit'; title = '短信验证码频率限制待复核'; level = 'medium'; status = 'open'; owner = '周宁'; note = '发布前检查同一手机号及 IP 的频率限制。' }
) }

$demoBoard = @{
    template = 'task-board-v1'
    title = '登录模块开发与验收 · PowerShell 联调'
    status = $demoBoardStatus
    tagline = '本地联调 · 模拟数据'
    description = '完成账号登录、短信验证、退出登录与权限校验。'
    summary = '核心功能已完成，正在进行发布前验收。'
    note = '本次推送包含结构化任务详情与成果，可从“当前成果”进入查看。'
    steps = @(
        @{ id = 'design'; title = '需求与方案'; progress = 100; state = 'done' }
        @{ id = 'develop'; title = '功能开发'; progress = 100; state = 'done' }
        @{ id = 'acceptance'; title = '测试与验收'; progress = $demoProgress; state = $(if ($demoVerified) { 'done' } else { 'active' }) }
    )
    detailSections = @(
        @{
            id = 'scope'; title = '任务范围与交付要求'; caption = '来自模拟后端的结构化详情'
            blocks = @(
                @{ type = 'text'; text = '本轮交付包含**账号密码登录、短信验证码登录、退出与角色权限校验**。当前内容由 PowerShell 通过真实 HTTP 接口发送。' }
                @{ type = 'keyValue'; items = @(
                    @{ label = '负责人'; value = '王明' }
                    @{ label = '测试负责人'; value = '周宁' }
                    @{ label = '发布条件'; value = '全部验收项通过，并归档测试报告' }
                ) }
            )
        }
        @{
            id = 'execution'; title = '执行步骤与进度'
            blocks = @(
                @{ type = 'table'; label = '任务拆解'; columns = @(
                    @{ key = 'task'; label = '工作项' }
                    @{ key = 'owner'; label = '负责人'; format = 'owner' }
                    @{ key = 'status'; label = '状态'; format = 'status' }
                ); rows = @(
                    @{ task = '登录流程与接口实现'; owner = '王明'; status = 'done' }
                    @{ task = '异常路径与权限测试'; owner = '周宁'; status = 'done' }
                    @{ task = '发布前验收'; owner = '周宁'; status = $(if ($demoVerified) { 'done' } else { 'active' }) }
                ) }
                @{ type = 'progress'; label = '验收进度'; value = $demoProgress }
            )
        }
        @{
            id = 'acceptance'; title = '发布前检查'
            blocks = @(
                @{ type = 'list'; items = @(
                    @{ text = '登录与退出主流程可用'; status = 'passed' }
                    @{ text = '登录失败和权限不足有明确反馈'; status = 'passed' }
                    @{ text = '短信验证码频率限制复核'; status = $demoCheckStatus }
                ) }
                @{ type = 'callout'; tone = $(if ($demoVerified) { 'success' } else { 'warning' }); title = '验收说明'; text = $demoVerdict }
            )
        }
    )
    result = @{
        template = 'result-v1'; title = '登录模块交付成果'; status = $ResultStatus
        summary = '账号登录、短信验证、退出与权限校验已完成，交付需求说明和接口文档，等待最终发布确认。'
        verdict = $demoVerdict
        owner = '王明'; team = '研发组'; teamSize = 2; producedAt = $demoNow; updatedAt = $demoNow
        metrics = @(
            @{ id = 'cases'; label = '测试用例'; value = '86'; unit = '个' }
            @{ id = 'rate'; label = '测试通过率'; value = $(if ($demoVerified) { '100' } else { '96' }); unit = '%'; tone = 'positive'; target = '95%'; targetStatus = 'met'; progress = $(if ($demoVerified) { 100 } else { 96 }) }
            @{ id = 'issues'; label = '待处理问题'; value = $(if ($demoVerified) { '0' } else { '1' }); unit = '项'; tone = $(if ($demoVerified) { 'positive' } else { 'negative' }) }
        )
        artifacts = @(
            @{ id = 'prd'; kind = 'document'; title = '登录模块需求说明'; description = '功能范围、交互规则和验收标准。'; content = "# 登录模块需求说明`n`n## 功能范围`n- 账号密码登录`n- 短信验证码登录`n- 退出登录`n- 角色权限校验`n`n## 验收要求`n验证码 5 分钟内有效；登录失败给出明确提示；退出后清除会话。" }
            @{ id = 'api'; kind = 'document'; title = '登录接口文档'; description = '请求字段、返回值与错误处理约定。'; content = "# 登录接口文档`n`n## POST /api/auth/login`n`n请求字段：account、password。`n`n成功返回：accessToken、expiresIn。`n`n错误反馈：账号密码错误、验证码过期、请求过于频繁。`n`n以上均为演示约定。" }
        )
        sections = @(
            $demoChanges
            @{ kind = 'documents'; id = 'docs'; title = '交付文档'; items = @(
                @{ id = 'prd-meta'; title = '登录模块需求说明'; version = 'v1.2'; at = $demoDate; status = 'done' }
                @{ id = 'api-meta'; title = '登录接口文档'; version = 'v1.0'; at = $demoDate; status = 'done' }
            ) }
        )
        checks = @(
            @{ id = 'main-flow'; label = '登录与退出主流程'; status = 'passed' }
            @{ id = 'permission'; label = '关键角色权限校验'; status = 'passed' }
            @{ id = 'rate-limit'; label = '短信验证码频率限制复核'; status = $demoCheckStatus }
        )
        tasks = @(
            @{ id = 'implementation'; title = '登录功能开发'; owner = '王明'; status = 'done'; progress = 100 }
            @{ id = 'testing'; title = '发布前验收'; owner = '周宁'; status = $(if ($demoVerified) { 'done' } elseif ($demoRejected) { 'blocked' } else { 'doing' }); progress = $demoProgress; note = '复核验证码频率限制。' }
        )
        risks = @($demoRisks)
        decisions = @(@{ id = 'auth-method'; question = '本轮支持哪些登录方式？'; choice = '账号密码 + 短信验证码'; at = $demoDate })
        versions = @(@{ id = 'v1'; version = 'v1.2'; note = '补齐登录异常提示与接口文档'; at = $demoDate; author = '王明'; status = 'released' })
        next = @($(if ($demoVerified) { '安排发布窗口并归档验收记录。' } else { '完成验证码频率限制复核，再进行最终验收。' }))
        note = '以上内容均为本地模拟业务数据。'
    }
}

# 模拟业务后端：每次发送当前成果集和稳定的历史引用，不在工作区创建版本副本。
$demoBoard.deliveries = @($demoHistory.deliveries | Where-Object { $_.sequence -le $Round })
$demoSelected = $demoBoard.deliveries[-1]
$demoBoard.result.runId = $demoSelected.id
$demoBoard.result.summary = $demoSelected.result.summary
$demoBoard.summary = $demoSelected.result.summary
$demoBoard.steps = $demoSelected.board.steps
$demoBoard.result.artifacts = $(if ($Round -eq 3) { $demoHistory.result.artifacts } else { $demoSelected.result.artifacts })
$demoBoard.result.producedAt = $demoSelected.createdAt
if ($Round -ge 2) {
    $demoBoard.result.sections[1].items = @($demoBoard.result.artifacts | ForEach-Object {
        @{ id = "$($_.id)-meta"; title = $_.title; version = $_.version; at = ([DateTimeOffset]$_.producedAt).ToString('yyyy-MM-dd HH:mm:ss'); status = 'done' }
    })
}
$demoBoard.result.versions = @($demoBoard.deliveries | Where-Object { $_.sequence -ge 2 } | ForEach-Object {
    @{ id = $_.id; version = "第 $($_.sequence) 轮交付"; note = $_.result.summary; at = ([DateTimeOffset]$_.createdAt).ToString('yyyy-MM-dd HH:mm:ss'); author = '王明'; status = 'released' }
})
if ($Round -ge 2) {
    $demoScopeCheck = $demoHistory.deliveries[1].result.checks[0] | ConvertTo-Json -Depth 10 | ConvertFrom-Json -AsHashtable
    if ($demoVerified) { $demoScopeCheck.versionId = $(if ($Round -eq 3) { 'prd-v2' } else { 'prd-v1' }) }
    $demoBoard.result.checks += $demoScopeCheck
} else {
    $demoBoard.status = 'running'
    $demoBoard.detailSections = @(@{
        id = 'scope'; title = '已确认的交付范围'; blocks = @(
            @{ type = 'text'; text = '已确认登录模块目标，后续将交付需求说明、接口文档和验收报告。' }
            @{ type = 'callout'; tone = 'info'; title = '尚未交付文档'; text = '本轮仅确认范围，不表示代码开发或验收已经完成。' }
        )
    })
    $demoBoard.result.status = 'draft'
    $demoBoard.result.verdict = '本轮已确认范围，文档将在后续执行中交付。'
    $demoBoard.result.artifacts = @()
    $demoBoard.result.sections = @()
    $demoBoard.result.checks = @()
    $demoBoard.result.metrics = @()
    $demoBoard.result.risks = @()
    $demoBoard.result.decisions = @()
    $demoBoard.result.tasks = @(
        @{ id = 'scope'; title = '确认交付范围'; status = 'done'; progress = 100 }
        @{ id = 'docs'; title = '形成首版文档'; status = 'todo' }
    )
    $demoBoard.result.next = @('形成首版需求说明与接口文档。')
}

$demoSnapshot = @{
    schemaVersion = '1.0'; seq = $demoSeq
    workspace = @{ id = $demoTeamId; name = '成果联调办公室' }
    conversations = @(@{
        id = 'login-demo'; title = '登录模块交付演示'; whiteboard = $demoBoard
        employees = @(
            @{ id = 'developer'; name = '王明'; role = '前端开发'; sceneActorId = 'code-agent'; online = $true }
            @{ id = 'tester'; name = '周宁'; role = '测试验收'; sceneActorId = 'review-agent'; online = $true }
        )
        tasks = @(
            @{ id = 'login'; title = '登录模块功能开发'; assigneeId = 'developer'; status = 'completed'; progress = 100; summary = '完成登录、退出和权限校验。'; updatedAt = $demoNow }
            @{ id = 'acceptance'; title = '登录模块发布前验收'; assigneeId = 'tester'; status = $demoBoardStatus; progress = $demoProgress; summary = $demoVerdict; updatedAt = $demoNow }
        )
        events = @(@{ id = "demo-$demoSeq"; kind = 'note'; summary = "PowerShell 推送模拟成果：$ResultStatus"; occurredAt = $demoNow })
    })
}

if ($Round -eq 1) {
    $demoSnapshot.conversations[0].tasks = @(
        @{ id = 'scope'; title = '确认登录模块交付范围'; assigneeId = 'developer'; status = 'completed'; progress = 100; updatedAt = $demoNow }
        @{ id = 'docs'; title = '形成首版需求与接口文档'; assigneeId = 'developer'; status = 'queued'; progress = -1; updatedAt = $demoNow }
    )
}

# 初始化按办公室 ID 新增或更新；未列出的办公室继续保留。
$demoMessage = @{ type = 'offices.initialize'; offices = @($demoSnapshot) }
if ($DryRun) {
    $demoMessage | ConvertTo-Json -Depth 40
    return
}
$demoResponse = Send-PawOfficeMessage $demoMessage
[ordered]@{
    code = $demoResponse.code
    msg = $demoResponse.msg
    offices = @($demoResponse.data.offices | Where-Object { $_.id -eq $demoTeamId })
} | ConvertTo-Json -Depth 5
Write-Host "已提交成果联调数据：seq=$demoSeq，成果状态=$($demoBoard.result.status)。" -ForegroundColor Green
if ($demoResponse.code -eq 202) { Write-Host '服务端已缓存；请打开或刷新正式办公室页面，等待连接后查看。' -ForegroundColor Yellow }
Write-Host "当前已模拟到第 $Round 轮；可用 -Round 1、-Round 2、-Round 3 逐轮发送。"
Write-Host '在连接了该后端的正式前端页面，选择“成果联调办公室” → “登录模块交付演示” → “当前成果”，通过交付轮次选择查看历史。'
Write-Host '页面地址请使用 npm run dev 启动日志中的 Vite 地址，并打开 /office/；保持现有两个服务运行即可。'
