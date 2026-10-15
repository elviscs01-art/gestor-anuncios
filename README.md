# Gestor de anúncios — base inicial

Esta entrega prepara a hospedagem e o acesso privado. Ainda não conecta ao Mercado Livre, não guarda tokens e não cria nem altera anúncios. Não provisiona banco de dados.

## Publicar no Render

1. Crie um repositório privado no GitHub, por exemplo `gestor-anuncios`.
2. Envie os arquivos desta pasta para a raiz do repositório. Não envie o ZIP nem credenciais.
3. No Render: New > Web Service. Conecte o GitHub e selecione o repositório.
4. Runtime: Node. Plano: Free. Root Directory: deixe vazio.
5. Build Command: `npm run check && npm test`.
6. Start Command: `npm start`. Health Check Path: `/health`.
7. Configure as variáveis `NODE_ENV=production` e `ADMIN_PASSWORD`.
8. Para ADMIN_PASSWORD, gere uma senha exclusiva e aleatória de pelo menos 20 caracteres e insira diretamente no Render. Não a envie no chat ou no GitHub.
9. Publique. Ao abrir o endereço HTTPS, o navegador solicitará usuário e senha: usuário `admin`, senha configurada acima.

Alternativa: usar `render.yaml` como Blueprint. Confira que cria somente um web service Free, sem banco.

## Limitações desta etapa

A autenticação inicial usa a janela de acesso do navegador (HTTP Basic sobre HTTPS), destinada a um administrador. O navegador pode lembrar a credencial até fechar a sessão; use um perfil privado em computador compartilhado. Esta base deve ser hospedada exclusivamente via HTTPS. O Render gerencia HTTPS. Antes de operar com tokens reais, implementar sessões com logout, identidade e armazenamento persistente criptografado.

O limite de tentativas é global para esta instância e reinicia quando o processo reinicia. Não há armazenamento de dados nem credenciais em arquivos. O banco gratuito de 30 dias só será criado na etapa de persistência. O serviço web gratuito suspende por inatividade.

## Verificação local

Node.js 22 ou superior. Nenhuma dependência externa nesta etapa.

- `npm run check`
- `npm test`
- Defina ADMIN_PASSWORD no ambiente e use `npm start` para desenvolvimento local.

Os testes verificam controle de acesso, saúde, bloqueio de escrita e limite de tentativas. Não comprovam funcionamento da hospedagem, da autorização Mercado Livre ou aparência no navegador. A verificação visual e o teste em hospedagem ficam para a publicação.

## Próximo marco

Obter o endereço público. Implementar callback OAuth, armazenamento criptografado e renovação de tokens. Depois configurar e autorizar a aplicação Mercado Livre e consultar MLB4155100949 e MLBU3354004962. Não preencher chaves Mercado Livre nesta versão: ela ainda não as utiliza.
