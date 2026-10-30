#requires -Version 7.0
[CmdletBinding()]
param([string]$BaseUrl = 'http://127.0.0.1:8765', [string]$ApiKey = 'pawoffice-demo-key', [int]$Port = 8799,
    [ValidateSet('ecommerce', 'engineering')][string]$Scenario = 'ecommerce',
    [ValidateSet('interactive', 'showcase')][string]$Mode = 'interactive',
    [ValidateRange(1, 5)][int]$Round = 5)
$ErrorActionPreference = 'Stop'
$savedUrl = $env:PAWOFFICE_URL
$savedKey = $env:PAWOFFICE_API_KEY
$savedPort = $env:PAWOFFICE_MOCK_PORT
$savedScenario = $env:PAWOFFICE_MOCK_SCENARIO
$savedMode = $env:PAWOFFICE_MOCK_MODE
$savedRound = $env:PAWOFFICE_MOCK_ROUND
try {
    $env:PAWOFFICE_URL = $BaseUrl
    $env:PAWOFFICE_API_KEY = $ApiKey
    $env:PAWOFFICE_MOCK_PORT = "$Port"
    $env:PAWOFFICE_MOCK_SCENARIO = $Scenario
    $env:PAWOFFICE_MOCK_MODE = $Mode
    $env:PAWOFFICE_MOCK_ROUND = "$Round"
    & node (Join-Path $PSScriptRoot 'workflow-mock.mjs')
    if ($LASTEXITCODE -ne 0) { throw '全流程 mock 启动或运行失败，请查看以上错误。' }
} finally {
    $env:PAWOFFICE_URL = $savedUrl
    $env:PAWOFFICE_API_KEY = $savedKey
    $env:PAWOFFICE_MOCK_PORT = $savedPort
    $env:PAWOFFICE_MOCK_SCENARIO = $savedScenario
    $env:PAWOFFICE_MOCK_MODE = $savedMode
    $env:PAWOFFICE_MOCK_ROUND = $savedRound
}
