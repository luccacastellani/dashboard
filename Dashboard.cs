// ==========================================================
//  Dashboard.exe — o botão da barra de tarefas
// ----------------------------------------------------------
//  Faz o mesmo que o iniciar.bat, mas como um programa de
//  verdade, com janela própria, porque:
//    - o Windows só deixa fixar na barra programas (.exe);
//    - uma janela preta de terminal aparece na barra com o
//      ícone do Terminal do Windows, não com o nosso.
//
//  Clique 1: liga o servidor (escondido) e abre o navegador.
//            Fica uma janelinha "Dashboard" minimizada na barra.
//  Clique 2 (já aberto): só abre a página de novo.
//  Fechar a janelinha (ou "Desligar"): desliga o servidor.
//
//  Para gerar o .exe de novo, rode o gerar-exe.bat.
// ==========================================================

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.NetworkInformation;
using System.Windows.Forms;

static class Programa
{
    public const int Porta = 8000;
    public const string Endereco = "http://localhost:8000";

    [STAThread]
    static void Main()
    {
        Directory.SetCurrentDirectory(AppDomain.CurrentDomain.BaseDirectory);

        // Já está no ar? Então é só abrir a página.
        if (PortaOcupada(Porta))
        {
            AbrirNavegador();
            return;
        }

        Application.EnableVisualStyles();
        Application.Run(new Janela());
    }

    public static bool PortaOcupada(int porta)
    {
        foreach (var fim in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners())
            if (fim.Port == porta) return true;
        return false;
    }

    public static void AbrirNavegador()
    {
        try { Process.Start(new ProcessStartInfo(Endereco) { UseShellExecute = true }); }
        catch (Exception) { /* sem navegador padrão: o endereço está na janela */ }
    }
}

// A janelinha que fica minimizada na barra enquanto o dashboard roda.
class Janela : Form
{
    Process servidor;
    readonly Label texto = new Label();

    public Janela()
    {
        Text = "Dashboard";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(360, 120);
        Font = new Font("Segoe UI", 10f);
        BackColor = Color.White;

        texto.AutoSize = false;
        texto.Bounds = new Rectangle(16, 14, 328, 44);
        texto.Text = "Ligando o dashboard...";
        Controls.Add(texto);

        var abrir = new Button { Text = "Abrir a página", Bounds = new Rectangle(16, 68, 150, 34) };
        abrir.Click += (s, e) => Programa.AbrirNavegador();
        Controls.Add(abrir);

        var desligar = new Button { Text = "Desligar", Bounds = new Rectangle(194, 68, 150, 34) };
        desligar.Click += (s, e) => Close();
        Controls.Add(desligar);

        Load += AoAbrir;
        FormClosing += AoFechar;
    }

    void AoAbrir(object sender, EventArgs e)
    {
        string erro = LigarServidor();
        if (erro != null)
        {
            WindowState = FormWindowState.Normal;
            texto.Text = erro;
            return;
        }

        texto.Text = "Dashboard no ar em " + Programa.Endereco + "\nFeche esta janela para desligar.";
        WindowState = FormWindowState.Minimized;

        // Abre o navegador com um pequeno atraso, para o servidor
        // ter tempo de começar a atender.
        var atraso = new Timer { Interval = 1200 };
        atraso.Tick += (s, a) => { atraso.Stop(); Programa.AbrirNavegador(); };
        atraso.Start();
    }

    // Tenta o py (launcher) e depois o python, como o iniciar.bat.
    string LigarServidor()
    {
        string[] candidatos = { "py", "python" };
        foreach (string exe in candidatos)
        {
            try
            {
                servidor = Process.Start(new ProcessStartInfo(exe, "servidor.py " + Programa.Porta)
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,      // sem janela preta
                });
                servidor.EnableRaisingEvents = true;
                servidor.Exited += (s, e) => BeginInvoke((Action)ServidorCaiu);
                return null;
            }
            catch (System.ComponentModel.Win32Exception)
            {
                // não encontrado: tenta o próximo
            }
        }
        return "Não encontrei o Python neste computador.\n" +
               "Instale em python.org (marque \"Add Python to PATH\").";
    }

    void ServidorCaiu()
    {
        if (IsDisposed) return;
        servidor = null;
        WindowState = FormWindowState.Normal;
        texto.Text = "O servidor parou sozinho.\nFeche e clique no ícone de novo.";
    }

    void AoFechar(object sender, FormClosingEventArgs e)
    {
        if (servidor == null || servidor.HasExited) return;
        // O "py" abre o python como filho: mata a árvore inteira,
        // senão a porta 8000 fica presa.
        try
        {
            Process.Start(new ProcessStartInfo("taskkill", "/F /T /PID " + servidor.Id)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
            }).WaitForExit(5000);
        }
        catch (Exception) { }
    }
}
