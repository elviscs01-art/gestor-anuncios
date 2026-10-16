# Correção 0.3.1 — marca e mensagens do validador

Esta atualização corrige o envio de atributos, incluindo marcas próprias: o texto preenchido é sempre enviado em value_name; identificadores importados só são reaproveitados quando correspondem a uma opção da ficha atual da categoria. Isso evita omitir a marca e depender de um identificador não resolvido.

As mensagens com type=warning passam a aparecer em Avisos do Mercado Livre, separadas das demais causas. Uma resposta HTTP de erro nunca é tratada como validação aprovada, mesmo que contenha somente avisos.

Envie os arquivos deste pacote na raiz do GitHub, substituindo os de mesmo nome. Aguarde o Render atualizar e abra o rascunho já salvo em Meus rascunhos. Clique novamente em Salvar e validar no Mercado Livre. Não é preciso recriar o rascunho, mudar a marca, apagar dados ou alterar as variáveis do Render. As mensagens antigas só são substituídas após a nova validação.

# Gestor de anúncios — versão 0.3

## Atualização para quem já está conectado

1. Extraia gestor-anuncios-v0.3.zip.
2. No GitHub, abra a pasta principal do repositório gestor-anuncios e use Add file > Upload files. Envie todos os arquivos extraídos, substituindo os de mesmo nome. Não envie o ZIP nem uma pasta externa envolvendo os arquivos.
3. Confirme Commit changes e aguarde o deploy automático do Render. Se ele não iniciar, use Manual Deploy > Deploy latest commit.
4. Mantenha o banco e todas as variáveis atuais. A nova tabela listing_drafts é criada automaticamente na inicialização; os dados e a autorização existentes são preservados.
5. O comando de build continua npm ci && npm run check && npm test; o comando de início continua npm start.
6. Abra o aplicativo, atualize a página e consulte seu anúncio. Clique em Criar rascunho a partir deste anúncio.
7. Edite os campos e informe a quantidade para o novo anúncio. Salve o rascunho ou use Salvar e validar no Mercado Livre.
8. Em Meus rascunhos você pode abrir os últimos 50 rascunhos salvos.

## O que a versão faz

Importa um anúncio simples da própria conta para um rascunho no PostgreSQL. Edita nome da família/título conforme o modelo, preço, quantidade, condição, tipo de anúncio, garantia, atributos e descrição; permite selecionar fotos já cadastradas. Consulta a categoria e seus atributos; atributos read_only e inferred não são enviados. Confere os dados principais por POST /items/validate. A resposta 204 significa aceitação desse conjunto de dados pelo validador, não publicação nem garantia de aprovação final.

A referência e o rascunho permanecem separados. Identificadores do anúncio, User Product, estado de publicação e vínculos de catálogo não são copiados para o envio. No modelo User Products é enviado family_name, sem title; o Mercado Livre gera o título. O estoque da referência não é copiado automaticamente.

## Limites desta etapa

Esta versão não publica nem altera anúncios. Descrição é salva, mas não é enviada ao validador de itens; compatibilidades não são transferidas nesta etapa. Seu número é exibido apenas como referência. Não há auditoria automática da aplicação mecânica das peças.

O formulário começa por um anúncio simples existente. Criação sem referência, importação de anúncios com variações, fotos novas, gestão de frete, publicação em catálogo e transferência de compatibilidades serão tratados nas próximas etapas. A configuração básica de envio da referência é aproveitada; modalidades específicas e condições finais de frete/taxas ainda precisam ser verificadas antes de publicar.

As validações locais e da API podem pedir novos campos. Alterar um rascunho invalida o resultado anterior. Alterações simultâneas em duas abas geram aviso, em vez de sobrescrever silenciosamente uma versão mais recente. O rascunho é salvo antes de consultar o validador.

## Verificação

26 testes automatizados passaram com dados e serviços simulados, abrangendo login, autorização, importação, campos, propriedade do vendedor, validação e salvamento. A nova tabela e a chamada real ao validador devem ser verificadas no Render com a conta conectada.

## Fontes para esta versão

- https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/preco-variacao
- https://developers.mercadolivre.com.br/pt_br/user-products
- https://developers.mercadolivre.com.br/pt_br/tendencias/validador-de-publicacoes
- https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/atributos

---

# Referência de configuração inicial (0.2)

Esta atualização adiciona login por formulário, logout, autorização OAuth com PKCE, armazenamento criptografado de tokens em PostgreSQL e consulta de um anúncio da conta conectada. O aplicativo ainda não cria, edita, pausa ou encerra anúncios. As únicas chamadas POST ao Mercado Livre são as trocas de autorização e renovação de acesso.

## 1. Atualizar o aplicativo existente

1. Extraia o pacote e envie os arquivos para a raiz do repositório privado elviscs01-art/gestor-anuncios, substituindo os anteriores. Não envie o ZIP ou node_modules.
2. No serviço existente do Render, entre em Settings e atualize Build Command para:
   `npm ci && npm run check && npm test`
3. Mantenha Start Command como `npm start`, plano Free e Health Check Path como `/health`.
4. Mantenha ADMIN_PASSWORD (mínimo de 20 caracteres) e NODE_ENV=production.
5. Adicione APP_BASE_URL com o valor exato `https://gestor-anuncios.onrender.com`.
6. Faça o deploy da versão mais recente. Não crie outro Web Service.
7. Abra o site: agora existe uma página de login. Digite somente a mesma senha; não há campo de usuário nem pop-up. Se o navegador insistir no pop-up anterior, abra em uma janela privada.

É possível publicar antes de configurar banco e credenciais. O painel mostrará o que falta e não permitirá conectar enquanto houver pendências. Nenhum banco é criado automaticamente pelo código ou pelo render.yaml.

## 2. Criar o banco quando estiver pronto para testar

No Render, use New > Postgres. Escolha a mesma região do aplicativo e o plano Free, se disponível na conta. Confira o resumo antes de criar. O prazo gratuito de 30 dias começa na criação do banco, e não no primeiro uso.

Quando disponível, copie a **Internal Database URL** para a variável DATABASE_URL do Web Service. Essa URL contém senha: insira apenas no Render. Use a rede interna, na mesma região. O código não desativa a verificação de certificados; para uma conexão externa, use as configurações TLS recomendadas pelo provedor.

As tabelas são criadas no primeiro início com o banco configurado. As sessões e autorizações passam a sobreviver a reinícios. Se o banco estiver indisponível, o aplicativo fecha o acesso em vez de continuar sem proteção.

## 3. Configurar a aplicação do Mercado Livre

Crie a aplicação na conta titular da empresa. Use os dados reais solicitados pelo DevCenter.

- Redirect URI: **https://gestor-anuncios.onrender.com/oauth/mercadolivre/callback**
- Ative **PKCE**. O código utiliza o método S256.
- Habilite leitura e acesso offline.
- Para a evolução planejada, configure Publicação e sincronização com leitura e escrita. Nesta versão, o aplicativo não executa alterações em anúncios.
- Métricas de negócio e leitura de vendas serão usadas nas próximas etapas; não são consumidas pela versão 0.2.
- Não configure notificações ainda: esta versão não tem endpoint de webhooks.
- Autorize com a conta principal/administradora do vendedor, não com uma conta de colaborador.

O app obtém as permissões aprovadas no DevCenter; não acrescente parâmetros de escopo inventados ao endereço de retorno. A documentação utiliza read, write e offline_access.

## 4. Variáveis do Web Service

| Variável | Valor |
| --- | --- |
| NODE_ENV | production |
| ADMIN_PASSWORD | Senha privada já configurada, mínimo 20 caracteres |
| APP_BASE_URL | https://gestor-anuncios.onrender.com |
| DATABASE_URL | Internal Database URL do banco |
| TOKEN_ENCRYPTION_KEY | Segredo aleatório de pelo menos 32 caracteres, diferente da senha de login; recomendamos 64 caracteres gerados por um gerenciador de senhas |
| MELI_CLIENT_ID | App ID da nova aplicação Mercado Livre |
| MELI_CLIENT_SECRET | Secret Key da aplicação Mercado Livre |
| MELI_SELLER_ID | Opcional: ID numérico do vendedor esperado, quando confirmado |

Não use os nomes das variáveis como seus valores. Não salve segredos no GitHub, no chat ou em capturas de tela. Guarde a chave de criptografia em seu gerenciador de senhas: substituí-la torna os tokens antigos ilegíveis e exige nova autorização.

## 5. Autorizar e validar a primeira consulta

1. Salve as variáveis e aguarde o deploy ficar Live.
2. Entre na página com a senha do aplicativo.
3. Clique em **Conectar Mercado Livre**.
4. Faça login no Mercado Livre e autorize. A senha do Mercado Livre é digitada somente no site oficial.
5. Ao retornar, confira o identificador de vendedor exibido.
6. Consulte MLB4155100949. O aplicativo confere o proprietário antes de buscar descrição e compatibilidades.
7. Confira título, categoria, atributos, User Product e compatibilidades contra sua conta. O painel diferencia falha de consulta de ausência de dados.

Compatibilidades de catálogo podem aparecer apenas como marca e total. Não são apresentadas como uma lista completa de veículos. Notas e demais dados disponíveis podem ser vistos nos detalhes da resposta.

## Comportamento do acesso

- Sessão de login de 8 horas com cookie Secure, HttpOnly e SameSite=Lax em produção.
- Formulários protegidos por origem e token CSRF.
- Estado OAuth de uso único, vinculado à sessão e válido por 10 minutos.
- Tokens e verificador PKCE criptografados com AES-256-GCM e propósitos distintos.
- Renovação ocorre sob bloqueio compartilhado no PostgreSQL, com releitura do token mais recente.
- Uma renovação incerta ou interrompida exige reconexão, sem reutilizar automaticamente o código anterior.
- Um código de autorização não é repetido automaticamente após falha.
- O aplicativo aceita uma conta de vendedor; uma autorização de outro vendedor não substitui silenciosamente a atual.
- A tela usa dados atuais da API. Esta versão não acumula histórico de métricas.

## Testes e limites de verificação

Execute `npm ci`, `npm run check` e `npm test`.
Os testes usam respostas simuladas e armazenamento em memória para verificar login, CSRF, OAuth, PKCE, criptografia, renovação concorrente, isolamento do vendedor e falhas parciais.
A integração real com PostgreSQL, a autorização da conta, as permissões e a aparência no navegador precisam ser validadas no Render após configurar os serviços. Uma suíte local aprovada não comprova esses passos.

O plano gratuito pode suspender por inatividade. Antes do vencimento do banco, exporte os dados ou mude de plano. Nenhum serviço pago foi criado por este pacote.

## Documentação usada

- https://developers.mercadolivre.com.br/autenticacao-e-autorizacao
- https://developers.mercadolivre.com.br/devcenter/compatibilidades-itens-e-produtos-de-autopecas
- https://render.com/docs/free
- https://render.com/docs/web-services

## Próximas entregas

Depois da consulta real validada: rascunhos, validação de publicação, criação com usuários de teste e, posteriormente, métricas gerais.
