# Gestor de anúncios — 0.4.0

Esta versão acrescenta criação de anúncios exclusivamente em uma conta brasileira de teste. A consulta e os rascunhos da loja continuam usando a conexão principal. As duas autorizações ficam em registros separados.

## Atualizar

1. Extraia gestor-anuncios-v0.4.0.zip.
2. No GitHub, entre na raiz de gestor-anuncios. Use Add file > Upload files e envie TODOS os arquivos extraídos, substituindo os de mesmo nome. Não envie o ZIP nem uma pasta contendo os arquivos.
3. Confirme Commit changes e aguarde o Render. O log de início deve mostrar Gestor 0.4.0.
4. Mantenha o banco e as variáveis atuais. Não é necessário recriar a aplicação Mercado Livre ou alterar o endereço de retorno.
5. Build: npm ci && npm run check && npm test. Start: npm start.
6. As tabelas lab_account, lab_connection e lab_attempts são criadas automaticamente no banco existente.

## Primeiro teste

1. Abra Testes de criação no painel e clique em Gerar conta de teste brasileira.
2. Guarde as credenciais mostradas em Mostrar credenciais de teste. Não envie a senha pelo chat.
3. Abra o gestor em uma janela anônima e entre com a senha normal do gestor.
4. Abra Testes de criação > Conectar conta de teste. No site do Mercado Livre, entre com as credenciais de TESTE, não com as da Densul. O aplicativo recusa a conta real nessa conexão.
5. Em Meus rascunhos, abra o rascunho de referência e salve as alterações desejadas.
6. Clique em Preparar teste de criação. A preparação usa a última versão salva; alterações não salvas no formulário não são incluídas.
7. Confira a conta de destino e os dados. Marque a confirmação e clique em Criar anúncio na conta de teste.
8. Confira o código do anúncio, a descrição e o status de pausa retornados. Uma falha na descrição ou pausa é mostrada separadamente.
9. Se a pausa não estiver confirmada, use Conferir ou solicitar pausa do teste. Isso não cria outro anúncio.

O Mercado Livre usa sua API pública também para contas de teste. O teste usa quantidade 1, tipo Clássico e nome Item de Teste - Por favor, NAO OFERTAR!. Para contas User Products, o nome é enviado como family_name e o título depende da plataforma. A descrição também recebe identificação de teste. A publicação é seguida de uma tentativa de envio da descrição e pausa; ela pode permanecer ativa se a pausa falhar.

A conta de teste é criada por POST /users/test_user com a autorização principal. As alterações de anúncio são permitidas apenas quando /users/me confirma o ID de teste cadastrado, site MLB e tag test_user. Fotos são enviadas por seus endereços públicos mlstatic, sem reutilizar IDs privados de imagem da loja. O modelo de título e a modalidade de envio são escolhidos com base na conta de teste e podem diferir da loja. O teste não confirma que o mesmo frete será aceito para a Densul.

## Falhas e duplicidade

Cada versão salva de rascunho possui uma tentativa por conta de teste. Duplo clique ou recarregamento não reenviam a criação. O marcador de envio é gravado antes da chamada externa. O código recebido é salvo antes de enviar a descrição.

Se a resposta da criação for incerta, não repita criando outro rascunho ou versão. Confira primeiro os anúncios da conta de teste. Não há reconciliação automática de uma publicação sem resposta. Se a geração da conta de teste for incerta, novas gerações são bloqueadas para evitar consumir outra conta.

Uma recusa confirmada é exibida com o retorno da API. Após corrigir a causa, salvar uma nova versão permite preparar outra tentativa. Respostas HTTP 400 do validador com somente avisos continuam sem equivaler a aprovação.

## Escopo e limites

O fluxo testa criação de anúncio simples e envio da descrição. Não transfere compatibilidades, variações ou vínculos de catálogo. Não publica na loja real. A etapa futura de produção terá revisão e autorização próprias.

Credenciais de teste e tokens são criptografados no banco com a chave atual. Não substitua TOKEN_ENCRYPTION_KEY: isso impede a leitura das credenciais salvas. Mantenha o banco ativo e protegido.

## Verificação

48 testes automatizados com respostas simuladas verificam autenticação, isolamento da conta, criação, proteção contra repetição, propriedade do anúncio, dados do teste e falhas parciais. A sintaxe dos módulos também foi conferida. A integração real com PostgreSQL, as permissões da API e a criação no Mercado Livre ainda precisam ser verificadas no Render; os testes locais não comprovam aprovação da publicação.

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


## Referências

- https://developers.mercadolivre.com.br/pt_br/realizacao-de-testes/realizacao-de-testes
- https://developers.mercadolivre.com.br/en_us/queries-about-the-user
- https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/preco-variacao
- https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/publicacao-de-produtos
