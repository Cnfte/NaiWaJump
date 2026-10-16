@echo off
chcp 65001 >nul
title NAIWA JUMP Launcher

echo ========================================================
echo          NAIWA JUMP - Local Game Launcher
echo ========================================================
echo.
echo Launching local server and opening default browser...

node --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Node.js detected, starting full Serverless API server on port 8080...
    start "" "http://localhost:8080"
    node server.js
    goto end
)

python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Python detected, starting http.server on port 8080...
    start "" "http://localhost:8080"
    if exist "public" (
        python -m http.server 8080 --directory public
    ) else (
        python -m http.server 8080
    )
    goto end
)

echo Starting with built-in PowerShell HttpListener...
start "" "http://localhost:8080"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$listener = New-Object System.Net.HttpListener; $listener.Prefixes.Add('http://localhost:8080/'); $listener.Start(); Write-Host 'Server running at http://localhost:8080... Press Ctrl+C to stop'; while($listener.IsListening){ $ctx = $listener.GetContext(); $req = $ctx.Request; $res = $ctx.Response; $raw = $req.RawUrl.Split('?')[0]; $unescaped = [System.Uri]::UnescapeDataString($raw); $path = './public' + $unescaped; if($path -eq './public/' -or $path -eq './public') { $path = './public/index.html' }; if(! (Test-Path $path)){ $path = '.' + $unescaped; if($path -eq './') { $path = './index.html' } }; if(Test-Path $path){ $bytes = [System.IO.File]::ReadAllBytes($path); $res.ContentLength64 = $bytes.Length; if($path.EndsWith('.html')){$res.ContentType='text/html; charset=utf-8'} elseif($path.EndsWith('.js')){$res.ContentType='application/javascript'} elseif($path.EndsWith('.css')){$res.ContentType='text/css'} elseif($path.EndsWith('.glb')){$res.ContentType='model/gltf-binary'} elseif($path.EndsWith('.png')){$res.ContentType='image/png'} elseif($path.EndsWith('.mp3')){$res.ContentType='audio/mpeg'} elseif($path.EndsWith('.jpg') -or $path.EndsWith('.jpeg')){$res.ContentType='image/jpeg'}; $res.OutputStream.Write($bytes, 0, $bytes.Length) } else { $res.StatusCode = 404 }; $res.OutputStream.Close() }"

:end
pause
