@echo off
REM Gera o Dashboard.exe a partir do Dashboard.cs, com o icone amarelo.
REM Usa o compilador de C# que ja vem com o Windows.
cd /d "%~dp0"
"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:anycpu /optimize /r:System.Windows.Forms.dll /r:System.Drawing.dll /win32icon:dashboard.ico /out:Dashboard.exe Dashboard.cs
if errorlevel 1 pause
