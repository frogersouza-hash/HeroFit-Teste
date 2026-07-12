# HeroFit — MVP Android (PWA)

Aplicativo fitness em formato PWA instalável no Android.

## Recursos incluídos

- câmera com detecção corporal por MediaPipe;
- contagem automática de agachamentos;
- cronômetro, repetições e pontos;
- evolução do herói por XP e atributos;
- registro de jiu-jítsu, karatê, acroyoga e corrida por tempo;
- missão semanal de consistência;
- cadastro de novos movimentos com exemplos corretos/incorretos;
- armazenamento local dos pontos corporais;
- exportação dos dados em JSON para revisão e treinamento coletivo;
- funcionamento como aplicativo instalado na tela inicial.

## Como testar no computador

A câmera exige HTTPS ou localhost. Na pasta do projeto, execute:

```bash
python3 -m http.server 8080
```

Abra `http://localhost:8080` no navegador.

## Como instalar no Android

1. Publique esta pasta em um serviço HTTPS, como GitHub Pages, Netlify, Vercel ou Cloudflare Pages.
2. Abra o endereço no Google Chrome do Android.
3. Permita o acesso à câmera.
4. Abra o menu do Chrome.
5. Toque em **Instalar app** ou **Adicionar à tela inicial**.

## Uso

1. Escolha **Agachamento — câmera**.
2. Apoie o celular na vertical e enquadre o corpo inteiro.
3. Toque em **Começar treino**.
4. Faça o agachamento até os joelhos dobrarem e volte a ficar em pé.
5. Finalize para salvar XP, força e o dia treinado.

Em outras modalidades, o MVP calcula pontos pelo tempo. Para cadastrar um movimento novo, preencha o nome, confirme o consentimento, escolha exemplo correto/incorreto e grave por cinco segundos.

## Privacidade

O cadastro coletivo salva coordenadas dos pontos do corpo, e não o vídeo. Ainda assim, uma versão pública precisa de política de privacidade, autenticação, servidor seguro, revisão dos dados e consentimento revogável.

## Limitações

- É um MVP, não um aplicativo médico.
- O reconhecimento automático incluído é de agachamento com uma pessoa.
- Jiu-jítsu e acroyoga com duas pessoas exigem detecção multipessoa e modelos treinados.
- O modelo coletivo precisa de servidor e pipeline de treinamento; o MVP coleta e exporta os exemplos.
- Um APK nativo assinado exige Android SDK, chave de assinatura e processo de build fora deste pacote.
