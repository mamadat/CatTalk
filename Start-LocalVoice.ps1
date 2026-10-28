param(
  [ValidateSet('tiny','base','small','medium','large-v3')][string]$Model='small',
  [string]$PythonPath,
  [string]$PackageIndex='https://pypi.org/simple'
)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtimeFolder=Join-Path $PSScriptRoot '.local\whisper'
$venvPython=Join-Path $runtimeFolder 'venv\Scripts\python.exe'
if(-not(Test-Path -LiteralPath $venvPython)){
  if(-not $PythonPath){
    $pythonCommand=Get-Command python -ErrorAction SilentlyContinue
    if($pythonCommand){$PythonPath=$pythonCommand.Source}else{throw 'Install Python 3.10+ or pass -PythonPath with the Python executable.'}
  }
  & $PythonPath -m venv (Join-Path $runtimeFolder 'venv')
  if($LASTEXITCODE -ne 0){throw 'Could not create the dedicated Python environment.'}
}
& $venvPython -m pip install --disable-pip-version-check --retries 1 --timeout 20 --index-url $PackageIndex -r (Join-Path $PSScriptRoot 'scripts\whisper-requirements.txt')
if($LASTEXITCODE -ne 0){throw 'Local speech dependencies could not be installed.'}
& $venvPython (Join-Path $PSScriptRoot 'scripts\download_whisper.py') --model $Model --root (Join-Path $runtimeFolder 'models')
if($LASTEXITCODE -ne 0){throw 'Model download did not finish; rerun the same command to resume.'}
Write-Host "Model '$Model' is installed. Set LOCAL_WHISPER_MODEL and LOCAL_WHISPER_QUALITY_MODEL to '$Model' in .env if needed, restart CatTalk, select Faster Whisper local and check again."
Write-Host 'No API key is required. Models and Python stay in .local/whisper; inference runs on this computer.'
