@echo off
:: ===== Elevate to Admin =====
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb runAs"
    exit /b
)

:: === Remove Firewall Rules ===
netsh advfirewall firewall delete rule name="Allow DNS"
netsh advfirewall firewall delete rule name="Allow Web"
netsh advfirewall firewall delete rule name="Block All Other Traffic"

:: === Reset Firewall to Default ===
netsh advfirewall reset

:: === Reset Wallpaper ===
reg delete "HKCU\Control Panel\Desktop" /v Wallpaper /f >nul 2>&1
RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters ,1 ,True

:: === Cleanup ===
del "%TEMP%\exam_wallpaper.jpg" >nul 2>&1

echo ✅ Exam mode disabled. Normal computer access restored.
pause