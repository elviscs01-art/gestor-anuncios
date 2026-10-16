# Atualização 0.9.0 — Replicação de anúncios

Envie todos os arquivos extraídos para a raiz do mesmo repositório, substituindo os de mesmo nome. Mantenha as variáveis do Render e o banco atual. O log deve mostrar Gestor 0.9.0 iniciado. As tabelas do novo fluxo são criadas automaticamente.

Fluxo: Replicação de anúncios → procurar por SKU ou ID → selecionar anúncio → confirmar → informar quantidade (1 a 20) → alterar os títulos e escolher Clássico ou Premium → Publicar. O caminho novo não usa rascunhos. Os rascunhos anteriores continuam acessíveis em Configurações e as publicações anteriores pelo histórico.

- Títulos são preenchidos com o anúncio-base e precisam mudar. Comparações ignoram maiúsculas/minúsculas, espaços repetidos e diferenças Unicode equivalentes. Títulos repetidos entre cópias também são bloqueados. O formulário preserva os textos digitados se houver erro.
- Todos os anúncios do lote são validados antes da primeira criação. Avisos do validador são exibidos; erros interrompem o lote sem publicar. Validação não garante aprovação final do Mercado Livre.
- As cópias são criadas na conta oficial, pausadas para completar descrição e compatibilidades e conferir os dados, e ativadas após sucesso. Pode existir exposição entre criação e pausa. Se a conferência falhar, o resultado informa a pendência. Se a ativação tiver resultado incerto, o status é indicado como não confirmado.
- Preço, quantidade, fotos, SKU, atributos editáveis, condições e descrição são importados do anúncio-base sem formulário intermediário. A quantidade é a mesma em CADA cópia; esta versão não divide nem sincroniza estoque físico entre anúncios.
- Compatibilidades próprias do vendedor são enviadas com notas e restrições e conferidas no destino. Compatibilidades CATALOGO, universais ou sem identificadores não são copiáveis integralmente pela API atual; nesses casos o fluxo bloqueia antes de criar. Anúncios de catálogo, com variações, sem quantidade disponível ou com mais de 200 compatibilidades também são explicitamente bloqueados nesta versão.
- User Products: o texto é enviado como family_name; o Mercado Livre gera o título final. A tela explica isso. Identidades de anúncio, user product, IDs de variações e contadores não são copiados.
- Cada lote é persistido, com exclusão mútua e registro antes de criar. Cliques repetidos e reabertura não repetem uma criação. Timeout ou resposta incerta interrompem o lote; confirme os anúncios da conta antes de tentar outro lote. Uma operação interrompida durante envio não é retomada automaticamente, para evitar duplicatas. O histórico permite acompanhar o resultado de cada cópia.
- As telas não prometem evitar moderação nem permitem duplicação idêntica de títulos. A aprovação e as condições finais continuam sujeitas às regras da plataforma.

Validação local: testes de dados preservados, título, lote, concorrência, autorização, erros incertos, compatibilidades e navegador simulado. Não foram feitas publicações reais durante o desenvolvimento.

Referências:
https://developers.mercadolivre.com.br/pt_br/compatibilidades-itens-e-produtos-de-autopecas
https://developers.mercadolivre.com.br/pt_br/user-products

---

# Correção 0.8.1 — Consulta inicial

A busca geral de pedidos agora omite a lista composta de status. Cancelados são consultados separadamente, com paginação e deduplicação por pedido. Erros da API informam HTTP, etapa e código técnico quando disponível, sem mostrar tokens ou dados de compradores. A causa na conta real ainda depende de verificação após o deploy. Atualize os arquivos de mesmo nome e clique em Atualizar resumo. Não é necessário alterar as permissões antecipadamente.

# Atualização 0.8.0 — Início e navegação

Extraia o pacote e envie os arquivos para a raiz do mesmo repositório no GitHub, substituindo os de mesmo nome. Não envie o ZIP nem crie uma subpasta. Aguarde o deploy no Render; o log deve indicar Gestor 0.8.0 iniciado. Não é necessário trocar credenciais ou apagar banco, rascunhos ou anúncios.

- Menu lateral: Início, Lista de anúncios, Publicações na conta oficial, Meus rascunhos, Diagnóstico de anúncios e Configurações.
- Configurações concentra conexão, endereço de autorização e consulta do anúncio de referência.
- Início coleta pedidos criados nos últimos 30 dias incluindo hoje, em Brasília; seleção de gráfico de 7 ou 30 dias. Valores brutos de produtos apenas em pedidos atualmente pagos, antes de taxas, sem frete, por data de criação do pedido. Não representa saldo líquido nem conciliação financeira de reembolsos.
- Reputação usa os períodos fornecidos pela API; ausência de informação aparece como indisponível, nunca como zero.
- Despacho: consulta até 12 envios distintos dos pedidos pagos mais recentes dentro do período. Mostra SLA disponível, excluindo Full, transporte e finalizados. É uma amostra, não uma fila completa de pendências. Atualize o resumo para consultar novamente os prazos.
- Vendas recentes: consulta a cada 60 segundos com a página visível, exibindo até 8 pedidos pagos recentes dentre os retornados pela API no período de 30 dias. Não é transmissão instantânea por notificações. O gráfico e os totais permanecem referentes à última atualização completa.
- Lista de anúncios: coleta independente, busca por título/código/SKU, filtro de status e páginas de 40 itens. Resumo na página inicial usa a última lista completa; carregue-a uma vez em Lista de anúncios.
- Coletas são salvas no banco e podem continuar ao voltar à página. Falhas preservam o resumo completo anterior. Máximo de 10 mil pedidos no período e 100 mil anúncios por coleta; acima disso a coleta é interrompida com mensagem, sem apresentar totais parciais como completos.
- Pedidos e envios exigem as permissões de leitura correspondentes. Se a API negar, verifique as permissões e reconecte em Configurações. Dados de compradores e endereços não são armazenados pelo painel.

Validação local: testes automatizados e navegador com respostas simuladas. O acesso aos dados reais depende do deploy e das permissões da conta; não foi testado com credenciais reais nesta atualização.

Referências oficiais consultadas:
- https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas
- https://developers.mercadolivre.com.br/pt_br/registre-o-seu-aplicativo/gerenciamento-de-envios
- https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/reputacao-de-vendedores

---

# Gestor de anúncios — versão 0.7.0

## Diagnóstico de anúncios

A página foi reorganizada conforme a estrutura do rascunho fornecido, mantendo o cabeçalho existente:
- Botão Carregar/Atualizar diagnóstico, indicador giratório e barra de progresso.
- Coleta por requisições em segundo plano, sem recarregar o documento inteiro.
- Filtros independentes Sem visitas e Tempo sem vender, que podem ser combinados.
- Períodos Últimos 30, 60 e 90 dias e opção de ausência no histórico correspondente. A opção Mais de 120 dias sem vendas também continua disponível.
- Status Ativo/Inativo e ordem de criação.
- Busca por título, MLB ou SKU.
- Contagem de anúncios filtrados.
- Cinco colunas: Anúncio, Status, Vendidos, Última venda e Visitas dos últimos 30 dias.
- Código MLB e SKUs com botões de copiar. Clique no título para consultar o anúncio.
- Tabela sem rolagem horizontal no computador; no celular, os mesmos campos são reorganizados por anúncio.

## Atualizar

1. Extraia gestor-anuncios-v0.7.0.zip.
2. Envie todos os arquivos para a raiz do GitHub, substituindo os anteriores. Inclua o novo metrics-client.js.
3. Confirme Commit changes e aguarde o Render mostrar Gestor 0.7.0 iniciado.
4. Abra Diagnóstico de anúncios e clique em Atualizar diagnóstico.
5. Aguarde concluir para carregar os novos dados de SKU e visitas por período. Bases antigas continuam visíveis, mas não contêm esses campos; ausências nunca são tratadas como zero.

Não é necessário alterar variáveis, banco ou comandos do Render.

## Filtros

Conforme confirmado, Últimos 30/60/90 dias significa zero visitas ou nenhuma venda paga na janela consultada; não significa faixas de 0–30, 31–60 e 61–90 dias desde a última ocorrência.

Os filtros são combinados por E: Sem visitas 30 dias + Tempo sem vender 60 dias mostra apenas anúncios que atendem às duas condições. Use Todos para não restringir um dos campos. Anúncios novos podem aparecer se não tiveram visitas/vendas no período consultado.

Sem visitas no histórico exige total disponível igual a zero e respeita o limite histórico de dois anos da API. Não equivale a uma afirmação de ausência durante toda a vida de anúncios mais antigos. Sem vendas registradas usa o contador de unidades vendidas igual a zero, desde que não haja pedido pago encontrado em contradição.

Inativo agrupa pausados, encerrados, em revisão e demais status retornados diferentes de ativo. Status desconhecido não é considerado inativo. O status original pode ser visto ao passar o mouse no indicador.

A coluna Visitas últimos 30 dias sempre mostra essa janela, mesmo quando o filtro é de 60 ou 90 dias. O total histórico não é usado como substituto. Os dados ausentes aparecem como —, com explicações de falha quando disponíveis.

## Carregamento

A barra fica sem percentual enquanto os códigos são localizados. Após conhecer o total, o percentual reflete anúncios analisados, não uma estimativa de tempo. Os filtros e campos permanecem na tela durante a coleta. Pausar e retomar não navegam para outra página.

O progresso é salvo por etapas. Ao reabrir a página, uma coleta em andamento é retomada automaticamente. A coleta não continua enquanto o aplicativo está fechado. Se a sessão expirar ou uma requisição falhar, a página informa o problema e permite conferir o progresso novamente.

A tela continua exibindo a última base concluída enquanto uma atualização está em andamento. Na primeira coleta, os resultados são marcados como parciais. Uma falha de consulta não é convertida em zero.

As novas consultas de visitas usam intervalos explícitos de 30, 60 e 90 dias. A aplicação verifica o código do anúncio, a contagem e as datas retornadas. Uma resposta incompleta ou de outro intervalo é indicada como indisponível.

## Verificação

81 testes automatizados passaram com serviços simulados. Incluem filtros combinados, períodos, limites, SKUs das variações, dados ausentes, propriedade do vendedor e proteção dos formulários/rotas JSON.

O teste de navegador confirmou uma única navegação do documento durante início, coleta e filtragem, preservação dos filtros durante o carregamento, cópia de SKU e todas as colunas visíveis em larguras de 1280, 1024, 768, 390 e 320 pixels. A interface foi inspecionada em imagens de desktop e celular.

Os novos retornos reais de visitas por intervalo precisam ser conferidos na primeira atualização pelo Render. Nenhuma consulta real à conta foi feita durante os testes locais. Os módulos de publicação permanecem disponíveis.

## Referência da API de visitas

https://developers.mercadolivre.com.br/pt_br/como-comecar/recurso-visits

---

# Referência da versão 0.6.0

## Novidade: métricas dos anúncios

Esta versão adiciona um painel de consulta à conta oficial, com:
- Anúncios sem visitas desde a criação, quando o histórico cobre toda a idade do anúncio.
- Anúncios com zero visitas no histórico disponível, separados quando não é possível afirmar “nunca”.
- Anúncios com contador de unidades vendidas igual a zero, ordenados por criação.
- Anúncios que já venderam e estão sem venda paga há pelo menos 30, 60 ou 90 dias, ou há mais de 120 dias.
- Filtros por status, título/código e criação do mais antigo ou mais recente.
- Última venda paga encontrada, visitas, unidades vendidas e dias sem vender.
- Indicação de falhas de consulta e de dados parciais.

Os períodos de inatividade são cumulativos. Um anúncio sem venda há 100 dias aparece nos grupos de 30, 60 e 90 dias. “Mais de 120 dias” exclui exatamente 120 dias.

## Atualizar e usar

1. Extraia gestor-anuncios-v0.6.0.zip.
2. Envie todos os arquivos extraídos para a raiz do GitHub, substituindo os anteriores. Não envie o ZIP nem a pasta que o envolve.
3. Confirme Commit changes e aguarde o Render. O início deve mostrar Gestor 0.6.0.
4. Mantenha o banco, variáveis e comandos atuais. A tabela metrics_jobs é criada automaticamente.
5. Abra Métricas dos anúncios > Carregar métricas.
6. Mantenha a página aberta durante a coleta. O aplicativo busca os códigos e consulta os anúncios em pequenos lotes.
7. Aguarde Coleta concluída, depois escolha grupo, período, status e ordem de criação.

A primeira coleta pode levar alguns minutos ou mais, dependendo do tamanho da conta e da API. Se fechar a página, abra Métricas e clique em Continuar atualização. Há botão para pausar e retomar. O progresso é salvo no banco; duas abas não executam o mesmo lote ao mesmo tempo.

Durante a primeira coleta, os resultados são parciais. Nas atualizações seguintes, a última coleta concluída permanece disponível até a nova terminar. A atualização não é agendada: ela ocorre enquanto você mantém o fluxo de coleta aberto. Dados não se atualizam sozinhos quando a página está fechada.

Se houver interrupção na listagem, o aplicativo mostra a falha. A listagem do Mercado Livre usa um cursor com expiração; uma pausa longa nessa fase pode exigir uma nova coleta. Cancele uma coleta pausada para iniciar outra, se necessário.

## Significado e limites das métricas

Visitas: o endpoint de total retorna os últimos dois anos. O grupo Nunca tiveram visitas exige total zero, data de criação dentro desse intervalo e ausência de parent_item_id. Anúncios mais antigos/republicados ficam em Zero visitas no histórico disponível. Isso não reconstrói dados anteriores aos fornecidos pela API.

Sem vendas registradas: sold_quantity igual a zero e nenhuma venda paga encontrada em contradição. O contador é de unidades, não de pedidos nem de faturamento líquido.

Pararam de vender: exige sold_quantity maior que zero e consulta de pedidos bem-sucedida. Busca o pedido mais recente atualmente paid, pelo código exato do anúncio e vendedor, ordenado por date_desc. Para vendedores, a ordenação e o painel usam date_closed, a data de confirmação do pedido.

A busca cobre 180 dias para atender os filtros solicitados. A API mantém pedidos por até 12 meses. Se o anúncio tem vendas históricas, mas nenhum pedido pago nesse intervalo, mostramos Pelo menos N dias, sem inventar a última data de venda. O limite leva em conta a idade do anúncio. Pedidos cancelados ou pendentes não entram nessa busca; não é uma análise financeira de devoluções e reembolsos.

Falhas de permissão, respostas incompletas e recursos indisponíveis não viram zero. Confira o grupo Dados incompletos e abra Dados indisponíveis na linha do anúncio. Métricas/visitas e pedidos precisam das permissões de leitura correspondentes. Se necessário, ajuste as permissões na aplicação Mercado Livre e reconecte a conta oficial; não é necessário fazer isso se as consultas já funcionarem.

A análise é por código MLB. Vários anúncios do mesmo produto não são agrupados por SKU ou aplicação. Todos os status são coletados conforme a listagem privada retorna; filtre Ativos se desejar focar anúncios disponíveis para venda. A lista começa pelos mais antigos, com 50 linhas por página.

Os dados são consultados ao longo da coleta, e podem mudar na plataforma entre chamadas. A data/hora da coleta é exibida. Contadores resumem a base carregada antes dos filtros. A aplicação guarda a coleta atual e a última concluída, não um histórico diário completo.

## Privacidade e funcionamento

Esta área não altera anúncios. As chamadas de negócio ao Mercado Livre são GET; a autorização pode renovar o token pelo fluxo já existente. São salvos apenas os campos necessários do anúncio e a data da última venda encontrada, sem nomes, e-mails ou endereços de compradores e sem armazenar pedidos completos.

Formulários de atualização exigem sessão, origem válida e CSRF. O vendedor é obtido da conexão autenticada, nunca do formulário. Um registro persistente com prazo de execução coordena os lotes e impede que uma etapa antiga sobrescreva uma coleta pausada. A listagem usa scan para não limitar a conta aos primeiros 1.000 anúncios.

## Verificação

73 testes automatizados com serviços simulados passaram, incluindo limites dos períodos, histórico incompleto, falhas de permissão, propriedade do vendedor, paginação, duplicação, retomada e proteção dos formulários. Os módulos passaram na verificação de sintaxe. As telas foram preparadas para desktop e celular.

A nova tabela PostgreSQL e as permissões/retornos reais precisam ser conferidos no Render. Nenhuma consulta real às métricas da conta foi feita durante o desenvolvimento local. A criação de anúncios da versão anterior continua disponível.

## Fontes

- https://developers.mercadolivre.com.br/pt_br/como-comecar/recurso-visits
- https://developers.mercadolivre.com.br/pt_br/imovel-consulta-de-usuarios/gerenciamento-de-vendas
- https://developers.mercadolivre.com.br/pt_br/itens-e-buscas

---

# Referência: publicação na conta oficial (0.5.0)

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
