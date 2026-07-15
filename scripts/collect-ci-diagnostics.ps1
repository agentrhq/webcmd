[CmdletBinding()]
param(
  [switch]$SelfTest
)

$ErrorActionPreference = 'Continue'

function Protect-SensitiveDiagnosticText {
  param(
    [AllowEmptyString()][string]$Text
  )

  $sensitiveLinePattern = '(?i)(?:^|[^a-z0-9])(?:auth(?:[-_]?token)?|authorization|proxy[-_]?authorization|bearer|token|api[-_]?key|secret|password|credentials?|set[-_]?cookie|cookie|cdp(?:[-_\s]?(?:endpoint|url))?|devtools(?:[-_\s]?url)?|live[-_\s]?url|browser[-_\s]?url|websocket[-_\s]?url|ws[-_\s]?url|page[-_\s]?(?:content|text|html)|innerhtml|outerhtml|snapshot)(?:$|[^a-z0-9])|document\.|<html|<body|\b(?:html|body|content)\b\s*"?\s*:'
  $schemeUrlPattern = '(?i)\b[a-z][a-z0-9+.-]*://[^\s"''<>]+'
  $sanitized = foreach ($line in ($Text -split "`r?`n")) {
    if ($line -match $sensitiveLinePattern) {
      '[REDACTED sensitive diagnostic line]'
      continue
    }
    $line -replace $schemeUrlPattern, '[REDACTED_URL]'
  }

  return ($sanitized -join [Environment]::NewLine)
}

function Write-SanitizedText {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [AllowEmptyString()][string]$Text
  )

  Protect-SensitiveDiagnosticText -Text $Text | Set-Content -LiteralPath $Path -Encoding utf8
}

function Write-SanitizedJson {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowNull()][AllowEmptyCollection()]$Value
  )

  Write-SanitizedText -Path $Path -Text (ConvertTo-Json -InputObject $Value -Depth 20)
}

function Get-DaemonLogMetadata {
  param(
    [Parameter(Mandatory = $true)][AllowNull()]$Response
  )

  $knownLevels = @('debug', 'info', 'warn', 'error')
  $logs = if ($null -ne $Response -and $null -ne $Response.logs) { @($Response.logs) } else { @() }
  $countsByKnownLevel = [ordered]@{}
  foreach ($knownLevel in $knownLevels) {
    $countsByKnownLevel[$knownLevel] = 0
  }

  $unrecognizedLevelCount = 0
  $timestamps = @()
  $maximumTimestamp = [DateTimeOffset]::UtcNow.AddDays(1).ToUnixTimeMilliseconds()
  foreach ($entry in $logs) {
    $level = if ($null -ne $entry.level) { ([string]$entry.level).ToLowerInvariant() } else { '' }
    if ($knownLevels -contains $level) {
      $countsByKnownLevel[$level] += 1
    } else {
      $unrecognizedLevelCount += 1
    }

    $timestamp = 0L
    if ($null -ne $entry.ts -and [Int64]::TryParse(([string]$entry.ts), [ref]$timestamp) -and $timestamp -ge 0 -and $timestamp -le $maximumTimestamp) {
      $timestamps += $timestamp
    }
  }

  $earliestTimestampUtc = $null
  $latestTimestampUtc = $null
  if ($timestamps.Count -gt 0) {
    $earliestTimestamp = [Int64](($timestamps | Measure-Object -Minimum).Minimum)
    $latestTimestamp = [Int64](($timestamps | Measure-Object -Maximum).Maximum)
    $earliestTimestampUtc = [DateTimeOffset]::FromUnixTimeMilliseconds($earliestTimestamp).UtcDateTime.ToString('o')
    $latestTimestampUtc = [DateTimeOffset]::FromUnixTimeMilliseconds($latestTimestamp).UtcDateTime.ToString('o')
  }

  return [pscustomobject][ordered]@{
    totalCount = $logs.Count
    countsByKnownLevel = [pscustomobject]$countsByKnownLevel
    unrecognizedLevelCount = $unrecognizedLevelCount
    earliestTimestampUtc = $earliestTimestampUtc
    latestTimestampUtc = $latestTimestampUtc
  }
}

function Assert-DiagnosticsSelfTest {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if (-not $Condition) {
    throw "Diagnostics self-test failed: $Message"
  }
}

function Invoke-DiagnosticsSelfTest {
  $sensitiveSamples = @(
    'auth: sensitive-value',
    'authToken: sensitive-value',
    'auth_token: sensitive-value',
    'authorization: Bearer sensitive-value',
    'bearer sensitive-value',
    'token: sensitive-value',
    'api-key: sensitive-value',
    'api_key: sensitive-value',
    'apiKey: sensitive-value',
    'secret: sensitive-value',
    'password: sensitive-value',
    'credentials: sensitive-value',
    'cookie: sensitive-value',
    'cdpUrl: ws://127.0.0.1/devtools/sensitive-value',
    'cdp_url: ws://127.0.0.1/devtools/sensitive-value',
    'CDP endpoint: ws://127.0.0.1/devtools/sensitive-value',
    'liveUrl: https://example.test/sensitive-value',
    'live_url: https://example.test/sensitive-value',
    'live URL: https://example.test/sensitive-value',
    'scheme only https://example.test/sensitive-value'
  )
  foreach ($sample in $sensitiveSamples) {
    $protected = Protect-SensitiveDiagnosticText -Text $sample
    Assert-DiagnosticsSelfTest -Condition (-not $protected.Contains('sensitive-value')) -Message "sensitive sample survived: $sample"
  }

  $unlabeledPageText = 'Customer account balance is 1234 and the recovery phrase is violet quartz'
  $syntheticLogs = [pscustomobject]@{
    ok = $true
    logs = @(
      [pscustomobject]@{ level = 'warn'; msg = $unlabeledPageText; text = 'private text'; value = 'private value'; data = @{ private = $true }; ts = 1704067200000 },
      [pscustomobject]@{ level = 'info'; msg = 'https://example.test/private'; ts = 1704153600000 },
      [pscustomobject]@{ level = 'custom'; msg = 'secret but unlabeled'; ts = -1 }
    )
  }
  $metadata = Get-DaemonLogMetadata -Response $syntheticLogs
  $metadataJson = ConvertTo-Json -InputObject $metadata -Depth 5
  Assert-DiagnosticsSelfTest -Condition ($metadata.totalCount -eq 3) -Message 'daemon log total count is incorrect'
  Assert-DiagnosticsSelfTest -Condition ($metadata.countsByKnownLevel.warn -eq 1 -and $metadata.countsByKnownLevel.info -eq 1) -Message 'known daemon log level counts are incorrect'
  Assert-DiagnosticsSelfTest -Condition ($metadata.unrecognizedLevelCount -eq 1) -Message 'unrecognized daemon log level count is incorrect'
  Assert-DiagnosticsSelfTest -Condition ($metadata.earliestTimestampUtc -eq '2024-01-01T00:00:00.0000000Z') -Message 'earliest bounded timestamp is incorrect'
  Assert-DiagnosticsSelfTest -Condition ($metadata.latestTimestampUtc -eq '2024-01-02T00:00:00.0000000Z') -Message 'latest bounded timestamp is incorrect'
  Assert-DiagnosticsSelfTest -Condition (-not $metadataJson.Contains($unlabeledPageText)) -Message 'unlabeled page text survived daemon metadata projection'
  Assert-DiagnosticsSelfTest -Condition ($metadataJson -notmatch '(?i)"(?:msg|text|value|data)"\s*:') -Message 'free-form daemon fields survived metadata projection'
  Assert-DiagnosticsSelfTest -Condition (($metadata.PSObject.Properties.Name -join ',') -eq 'totalCount,countsByKnownLevel,unrecognizedLevelCount,earliestTimestampUtc,latestTimestampUtc') -Message 'daemon metadata contains a non-allowlisted field'

  Write-Host 'Diagnostics self-test passed.'
}

if ($SelfTest) {
  $ErrorActionPreference = 'Stop'
  Invoke-DiagnosticsSelfTest
  return
}

$artifactRoot = Join-Path $PWD 'artifacts/windows-cloak'
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null

$runnerMetadata = [ordered]@{
  collectedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  nodeVersion = (& node --version 2>&1 | Out-String).Trim()
  npmVersion = (& npm --version 2>&1 | Out-String).Trim()
  runner = [ordered]@{
    os = $env:RUNNER_OS
    architecture = $env:RUNNER_ARCH
    imageOs = $env:ImageOS
    imageVersion = $env:ImageVersion
    machineName = $env:COMPUTERNAME
  }
  github = [ordered]@{
    runId = $env:GITHUB_RUN_ID
    runAttempt = $env:GITHUB_RUN_ATTEMPT
    sha = $env:GITHUB_SHA
  }
}

try {
  $windows = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
  $runnerMetadata['windows'] = [ordered]@{
    caption = $windows.Caption
    version = $windows.Version
    buildNumber = $windows.BuildNumber
  }
} catch {
  $runnerMetadata['windows'] = @{ error = 'Windows metadata unavailable' }
}
Write-SanitizedJson -Path (Join-Path $artifactRoot 'runner-metadata.json') -Value $runnerMetadata

$headers = @{ 'X-Webcmd' = '1' }
try {
  $daemonStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:9777/status' -Headers $headers -TimeoutSec 5
  Write-SanitizedJson -Path (Join-Path $artifactRoot 'daemon-status.json') -Value $daemonStatus
} catch {
  Write-SanitizedText -Path (Join-Path $artifactRoot 'daemon-status.txt') -Text 'Daemon status unavailable.'
}

try {
  $daemonLogs = Invoke-RestMethod -Uri 'http://127.0.0.1:9777/logs' -Headers $headers -TimeoutSec 5
  $daemonLogMetadata = Get-DaemonLogMetadata -Response $daemonLogs
  Write-SanitizedJson -Path (Join-Path $artifactRoot 'daemon-log-metadata.json') -Value $daemonLogMetadata
} catch {
  Write-SanitizedText -Path (Join-Path $artifactRoot 'daemon-log-metadata.txt') -Text 'Daemon log metadata unavailable.'
}

$processMetadata = Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessName -match '(?i)^(node|chrome|chromium|cloak)' } |
  ForEach-Object {
    [ordered]@{
      name = $_.ProcessName
      id = $_.Id
      startedAtUtc = if ($_.StartTime) { $_.StartTime.ToUniversalTime().ToString('o') } else { $null }
      workingSetBytes = $_.WorkingSet64
      cpuSeconds = $_.CPU
    }
  }
Write-SanitizedJson -Path (Join-Path $artifactRoot 'process-metadata.json') -Value @($processMetadata)

$cloakRoot = if ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.webcmd/cloak' } else { $null }
$cloakLogMetadata = @()
if ($cloakRoot -and (Test-Path -LiteralPath $cloakRoot)) {
  $cloakLogMetadata = Get-ChildItem -LiteralPath $cloakRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -eq '.log' -or $_.Name -match '(?i)(debug|log)' } |
    ForEach-Object {
      [ordered]@{
        relativePath = [System.IO.Path]::GetRelativePath($cloakRoot, $_.FullName)
        bytes = $_.Length
        lastWriteUtc = $_.LastWriteTimeUtc.ToString('o')
      }
    }
}
Write-SanitizedJson -Path (Join-Path $artifactRoot 'cloak-log-metadata.json') -Value @($cloakLogMetadata)

Write-Host "Sanitized diagnostics written to $artifactRoot"
