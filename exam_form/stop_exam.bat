@echo off
:: ===== Elevate to Admin =====
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting admin permissions...
    powershell -Command "Start-Process '%~f0' -Verb runAs"
    exit /b
)

echo Restoring firewall settings and clearing wallpaper...

:: Reset firewall
netsh advfirewall reset

:: Clear custom wallpaper
REG DELETE "HKCU\Control Panel\Desktop" /v Wallpaper /f >nul
RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters ,1 ,True

echo ✅ System restored to normal.
pause
