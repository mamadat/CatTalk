param([ValidateSet('TranslateGemma','Qwen','LibreTranslate')][string]$Engine='TranslateGemma')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$composeFile=Join-Path $PSScriptRoot 'compose.local.yml'
if($Engine -ne 'LibreTranslate' -and (Get-Command ollama -ErrorAction SilentlyContinue)) {
  $localModel=if($Engine -eq 'Qwen'){'qwen3:4b'}else{'translategemma:4b'}
  $env:OLLAMA_NO_CLOUD='1'
  Write-Host 'Ensure the local Ollama application/server is running. Downloading the selected model if missing...'
  & ollama pull $localModel
  if($LASTEXITCODE -ne 0){throw 'Model download failed. Start Ollama, check the connection and retry.'}
}else{
  if(-not(Get-Command docker -ErrorAction SilentlyContinue)){throw 'Install Ollama from https://ollama.com/download or start Docker Desktop. See docs/LOCAL_TRANSLATION.md.'}
  $null=& docker info --format '{{.ServerVersion}}' 2>$null
  if($LASTEXITCODE -ne 0){throw 'Docker Desktop is not running. Start its Linux engine and retry; see docs/LOCAL_TRANSLATION.md.'}
  if($Engine -eq 'LibreTranslate'){
    & docker compose -f $composeFile --profile libretranslate up -d libretranslate
    if($LASTEXITCODE -ne 0){throw 'LibreTranslate startup failed.'}
    Write-Host 'LibreTranslate is starting on localhost:5000. Initial language downloads can take several minutes.'
  }else{
    & docker compose -f $composeFile --profile ollama up -d ollama
    if($LASTEXITCODE -ne 0){throw 'Ollama startup failed.'}
    $localModel=if($Engine -eq 'Qwen'){'qwen3:4b'}else{'translategemma:4b'}
    $serverReady=$false
    for($attempt=0;$attempt -lt 20;$attempt++){
      try{$null=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2;$serverReady=$true;break}catch{Start-Sleep -Seconds 1}
    }
    if(-not $serverReady){throw 'The Ollama container did not become ready. Inspect docker compose logs.'}
    & docker compose -f $composeFile exec -T ollama ollama pull $localModel
    if($LASTEXITCODE -ne 0){throw 'Local model download failed.'}
  }
}
Write-Host 'Open CatTalk, select the local engine and press Check again. No API key is needed.'
