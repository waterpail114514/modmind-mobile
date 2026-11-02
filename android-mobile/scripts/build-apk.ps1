param([string]$SdkRoot = $env:ANDROID_SDK_ROOT, [string]$ToolRoot = $env:MODMIND_ANDROID_TOOLS, [ValidateSet('debug','release','both')][string]$Variant='release')
$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $mobileRoot
foreach ($requiredRuntimeFile in @('android/app/src/main/assets/local-runtime.zip', 'android/app/src/main/assets/local-runtime-version.json', 'android/app/src/main/jniLibs/arm64-v8a/libmm_node_exec.so', 'android/app/src/main/jniLibs/arm64-v8a/libmm_java_exec.so', 'android/app/src/main/jniLibs/arm64-v8a/libmm_codex_exec.so', 'android/app/src/main/jniLibs/arm64-v8a/libmm_runtime_paths.so')) {
    if (-not (Test-Path -LiteralPath (Join-Path $mobileRoot $requiredRuntimeFile))) { throw "Missing bundled runtime input: $requiredRuntimeFile. Follow android-mobile/README.md first." }
}
if (-not $ToolRoot) { $ToolRoot = 'D:\Codex\UserData\tools\android' }
if (-not $SdkRoot) { $SdkRoot = Join-Path $ToolRoot 'sdk' }
if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'platforms\android-35\android.jar'))) { throw 'Android SDK 35 is required; see README.md' }
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:GRADLE_USER_HOME = Join-Path $ToolRoot 'gradle-cache'
$javaSocketDirectory = Join-Path $ToolRoot 'tmp'
New-Item -ItemType Directory -Path $javaSocketDirectory -Force | Out-Null
# Same Windows AF_UNIX workaround as the desktop managedJavaEnvironment service.
$env:JAVA_TOOL_OPTIONS = "$env:JAVA_TOOL_OPTIONS -Djdk.net.unixdomain.tmpdir=$javaSocketDirectory".Trim()
node (Join-Path $PSScriptRoot 'build.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Android asset build failed' }
$gradleRoot = Join-Path $mobileRoot 'android'
$wrapper = Join-Path $gradleRoot 'gradle\wrapper'
New-Item -ItemType Directory -Path $wrapper -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'vendor\gradle-wrapper\gradle-wrapper.jar') -Destination (Join-Path $wrapper 'gradle-wrapper.jar') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'vendor\gradle-wrapper\gradlew.bat') -Destination (Join-Path $gradleRoot 'gradlew.bat') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'vendor\gradle-wrapper\gradlew') -Destination (Join-Path $gradleRoot 'gradlew') -Force
$stageParent = Join-Path $ToolRoot 'build'
$stage = Join-Path $stageParent 'modmind-mobile-native'
if (Test-Path -LiteralPath $stage) {
    $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
    if ($resolvedStage -ne [System.IO.Path]::GetFullPath($stage) -or -not $resolvedStage.StartsWith([System.IO.Path]::GetFullPath($stageParent) + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe Android build staging path' }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage -Force | Out-Null
robocopy $gradleRoot $stage /E /XD .gradle build /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -gt 7) { throw 'Could not stage Android sources' }
Push-Location $stage
try { $tasks=if($Variant -eq 'both'){@('assembleDebug','assembleRelease')}elseif($Variant -eq 'release'){@('assembleRelease')}else{@('assembleDebug')}; & (Join-Path $stage 'gradlew.bat') @tasks --no-daemon --console=plain --max-workers=2; if ($LASTEXITCODE -ne 0) { throw 'Android APK build failed' } }
finally { Pop-Location }
$variants=if($Variant -eq 'both'){@('debug','release')}else{@($Variant)}
foreach($builtVariant in $variants){
    $apkDirectory = Join-Path $gradleRoot "app\build\outputs\apk\$builtVariant"
    New-Item -ItemType Directory -Path $apkDirectory -Force | Out-Null
    $apkFile=Join-Path $apkDirectory "app-$builtVariant.apk"
    Copy-Item -LiteralPath (Join-Path $stage "app\build\outputs\apk\$builtVariant\app-$builtVariant.apk") -Destination $apkFile -Force
    node (Join-Path $PSScriptRoot 'verify-apk.mjs') $apkFile
    if ($LASTEXITCODE -ne 0) { throw 'APK asset verification failed' }
    Get-Item -LiteralPath $apkFile | Select-Object FullName, Length
    if($builtVariant -eq 'release'){
        $version=[regex]::Match((Get-Content -LiteralPath (Join-Path $gradleRoot 'app\build.gradle') -Raw),"versionName '([^']+)'").Groups[1].Value
        if(-not $version){throw 'Version name missing'}
        $releaseDirectory=Join-Path $repoRoot 'release'
        New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
        $delivery=Join-Path $releaseDirectory "ModMind-Mobile-$version-arm64.apk"
        Copy-Item -LiteralPath $apkFile -Destination $delivery -Force
        $sha=(Get-FileHash -LiteralPath $delivery -Algorithm SHA256).Hash.ToLowerInvariant()
        [System.IO.File]::WriteAllText($delivery+'.sha256',$sha+'  '+[System.IO.Path]::GetFileName($delivery)+[Environment]::NewLine,(New-Object System.Text.UTF8Encoding($false)))
        Get-Item -LiteralPath $delivery | Select-Object FullName,Length
    }
}
