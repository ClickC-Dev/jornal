## Objetivo
- Criar um gerador que combina várias `Capas` (.png) + um único `Jornal` (.pdf) + várias `ContraCapas` (.png) e entrega vários PDFs prontos.
- Nome de cada PDF: `NomeDaCapa - NomeDoJornal.pdf`.
- Fluxo em 5 passos com wizard, upload arrasta-e-solta, barra de progresso, download em `.zip` e confete.

## Arquitetura
- Frontend: React + TypeScript, componente Wizard com 5 passos e Dropzones.
- Backend: Node.js com API `multipart/form-data` para processar e gerar PDFs.
- Geração de PDF: biblioteca `pdf-lib` (merge de imagens como páginas + cópia das páginas do PDF do Jornal).
- Empacotamento ZIP: `archiver` para streaming do `.zip` ao cliente.
- Progresso: Server-Sent Events (SSE) simples por `jobId` para porcentagem.

## Fluxo do Usuário (Wizard)
- Passo 1: Upload de múltiplas `Capas` (`.png`), mostra contagem e nomes.
- Passo 2: Upload do `Jornal` (`.pdf`) e campo opcional de metadados do mês.
- Passo 3: Upload de múltiplas `ContraCapas` (`.png`), mostra contagem e nomes.
- Passo 4: Envia tudo para API, exibe barra de progresso com porcentagem (SSE).
- Passo 5: Ao concluir, mostra botão para baixar `.zip` e dispara confete.

## API
- Endpoint `POST /api/gerador` (conteúdo `multipart/form-data`).
  - Campos: `covers[]` (png), `journal` (pdf), `backs[]` (png), `metadata` (opcional).
  - Validações: tipos e tamanho; `journal` obrigatório; `covers.length >= 1`.
  - Regras de pareamento:
    - Se `backs.length === covers.length`: parear por índice.
    - Se `backs.length === 1`: usar a mesma contracapa para todas.
    - Caso contrário: erro amigável informando que a contagem não corresponde.
- Retorno: stream do `.zip` + `Content-Disposition` com nome `jornais-<aaaa-mm-dd>.zip`.

## Geração de PDFs
- Carregar `journalPdf = PDFDocument.load(journalBytes)` uma vez.
- Para cada índice `i`:
  - `doc = PDFDocument.create()`.
  - Página 1: `embedPng(capacBytes[i])` e desenhar em página no tamanho do Jornal (A4 ou do 1º page).
  - Copiar todas as páginas do `journalPdf` com `copyPages` e adicionar em ordem.
  - Página final: `embedPng(backBytes[i or 0])` e desenhar.
  - `doc.save()` para obter `bytes` do PDF.
  - Nome do arquivo: `sanitize(baseName(capa[i])) + ' - ' + sanitize(baseName(journal)) + '.pdf'`.
  - Adicionar ao `archiver` (zip) imediatamente.
- Atualizar progresso a cada PDF gerado (`processed/total`).

## Barra de Progresso
- SSE em `GET /api/gerador/progresso?jobId=...`.
- Eventos: `{ processed, total, percent }`.
- Frontend: exibe porcentagem, animando suavemente.

## UI e UX
- Dropzones com arrastar-e-soltar, pré-visualização de miniaturas e contador.
- Botão "Próximo" habilitado somente quando o passo está válido.
- Mensagens: amigáveis conforme os textos do fluxo; estados de erro claros.
- Confete: `canvas-confetti` ao finalizar.

## Nomes e Sanitização
- Remover extensão e caracteres inválidos (`/\:*?"<>|`).
- Normalizar espaços múltiplos e trim; manter acentos.

## Desempenho
- Reutilizar documento do Jornal com `copyPages` para cada saída.
- Processar de forma sequencial para simplicidade inicial; opcional: fila com 2–4 paralelos.
- Limite de tamanho por arquivo e de quantidade (ex. até 200 capas/contracapas).

## Erros e Edge Cases
- Tipos inválidos: mensagem imediata na UI.
- Contagens incompatíveis: instrução para ajustar conforme regras de pareamento.
- Páginas do Jornal com tamanhos variados: usar tamanho da primeira página como referência e centralizar.

## Testes
- Testes unitários para o pipeline: cover+journal+back resultam em número correto de páginas.
- Teste de nomes gerados e sanitização.
- Teste de zip com múltiplos PDFs e progresso correto.

## Entregáveis
- Wizard funcional com 5 passos.
- API que recebe arquivos e retorna `.zip` com PDFs.
- Barra de progresso real, naming adequado, confete ao finalizar.

## Próximo
- Ao aprovar, implemento frontend e backend conforme acima, seguindo seu estilo visual do screenshot e seus padrões atuais.