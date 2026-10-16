# Gestor de anúncios — versão 0.5.0

## Atualização

Extraia o ZIP e envie todos os arquivos para a raiz do repositório GitHub, substituindo os de mesmo nome. Não envie o ZIP nem uma pasta externa. Confirme Commit changes e aguarde o Render mostrar Gestor 0.5.0 iniciado.

Mantenha as variáveis e o banco existentes. Build: npm ci && npm run check && npm test. Start: npm start. A tabela official_attempts é criada na inicialização. A conexão oficial já salva é utilizada; a conta de teste não é necessária.

## Publicar na conta oficial

1. Em Meus rascunhos, abra o rascunho e preencha os dados reais do anúncio desejado: nome, preço, quantidade, fotos e atributos.
2. Salve as alterações. O botão de revisão usa a última versão salva.
3. Clique em Revisar publicação na conta oficial.
4. Confira a conta de destino, nome, preço, quantidade, tipo, envio, atributos, descrição e dados completos. Não há alteração automática para nome de teste, quantidade 1 ou tipo Clássico.
5. Marque a confirmação e clique em Criar na conta oficial e solicitar pausa.
6. Confira o código criado e o status retornado. A aplicação salva o código antes das próximas operações, solicita pausa e depois envia a descrição.
7. Se a pausa falhar, confira o anúncio diretamente no Mercado Livre ou use Solicitar pausa novamente. Essa ação não cria outro anúncio.

A criação ocorre na conta oficial. O anúncio pode receber visitas e compras até a pausa ser confirmada; se a pausa falhar, pode permanecer ativo. Excluir depois não garante desfazer efeitos na conta. O aplicativo não exclui anúncios automaticamente.

O anúncio de referência não é editado, pausado ou encerrado por este fluxo. As operações posteriores usam apenas o código do novo anúncio registrado na tentativa.

## Validação e frete

A preparação consulta novamente a categoria, os atributos e as modalidades habilitadas do vendedor. Usa o frete salvo no rascunho, sem trocar silenciosamente ME1 por ME2. Não calcula tarifas nem custos de frete.

Pendências bloqueantes da última validação impedem preparar a publicação. Respostas classificadas como somente avisos permitem prosseguir com revisão explícita, sem serem consideradas aprovação. A API de criação tem a decisão final. Um rascunho sem validação remota passa pela conferência local; essa conferência também não garante aprovação.

Compatibilidades de veículos NÃO são transferidas. Variações e vínculos de catálogo ainda não fazem parte deste fluxo. O anúncio deve ter dados reais e adequados ao produto/aplicação pretendida.

## Controle das tentativas

Cada versão salva do rascunho tem uma tentativa oficial. Duplo clique, recarregamento ou reenvio da mesma tentativa não repetem a criação. Uma prévia de versão antiga é bloqueada se o rascunho mudou.

Se a resposta for incerta, o sistema não reenvia automaticamente. Confira a conta oficial antes de preparar outra versão ou outro rascunho. Ainda não existe reconciliação automática para localizar uma criação cuja resposta foi perdida.

Descrição e pausa têm resultados separados. A falha dessas etapas não apaga o código já criado. O histórico fica em Publicações na conta oficial. O fluxo antigo de contas de teste continua separado em /testes.

## Verificação

Testes automatizados usam serviços e armazenamento simulados. Verificam conta de destino, proteção dos formulários, ordem de criação/pausa/descrição, falhas parciais, revisão desatualizada e prevenção de reenvio. A integração real com PostgreSQL e a publicação no Mercado Livre precisam ser conferidas após a atualização no Render. Nenhum anúncio real foi criado durante o desenvolvimento local.

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

- https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/publicacao-de-produtos
- https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-sincronizacao-de-publicacoes
