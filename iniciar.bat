@echo off
REM ==========================================================
REM  Year 2 - IBEB - Erasmus University
REM  De um duplo clique neste arquivo para abrir o dashboard.
REM ==========================================================

cd /d "%~dp0"
title Year 2 - IBEB - Dashboard

echo.
echo   ============================================
echo    Year 2 - IBEB - Erasmus University
echo   ============================================
echo.

REM --- Ja esta no ar? Entao so abre a pagina e pronto. ---
REM (E o que acontece quando se clica de novo na barra de tarefas.)

netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul 2>nul
if %errorlevel%==0 (
    echo   O dashboard ja esta aberto. Abrindo a pagina...
    start "" "http://localhost:8000"
    exit /b 0
)

REM --- Procura um servidor disponivel: py, python ou node ---

set "SERVER="

where py >nul 2>nul
if %errorlevel%==0 (
    set "SERVER=py servidor.py 8000"
    goto :encontrado
)

where python >nul 2>nul
if %errorlevel%==0 (
    set "SERVER=python servidor.py 8000"
    goto :encontrado
)

where npx >nul 2>nul
if %errorlevel%==0 (
    set "SERVER=npx --yes http-server -p 8000 -c-1"
    goto :encontrado
)

echo   [ERRO] Nao encontrei Python nem Node neste computador.
echo.
echo   Instale o Python em https://www.python.org/downloads/
echo   (marque a opcao "Add Python to PATH" durante a instalacao)
echo.
pause
exit /b 1

:encontrado

echo   Endereco:  http://localhost:8000
echo.
echo   Abrindo o navegador...
echo   Para desligar, feche esta janela.
echo.

REM Abre o navegador com um pequeno atraso, para dar tempo
REM do servidor comecar a atender.
start "" /min powershell -NoProfile -Command "Start-Sleep -Milliseconds 1200; Start-Process 'http://localhost:8000'"

%SERVER%

REM Se chegou aqui, o servidor parou.
echo.
echo   O servidor foi encerrado.
echo   Se a porta 8000 estiver ocupada, feche o outro programa
echo   que a esteja usando e tente de novo.
echo.
pause
