# Automação ClickUp → Google Sheets (Demandas TI)

Script em **Google Apps Script** que automatiza o preenchimento diário da planilha de
demandas do setor de TI: lê as tarefas e subtarefas **concluídas no ClickUp**, grava na
planilha e envia **relatórios por e-mail** (diário e semanal aos sábados).

---

## 📋 Descrição

- Busca diária no ClickUp (tarefas + subtarefas concluídas no dia)
- Contagem por **responsável** e **nível de dificuldade** (N1, N2, N3)
- Tarefas/subtarefas com **vários responsáveis** contam para cada um
- Grava **apenas a linha do dia atual** (limpa a linha antes de escrever)
- Recalcula **semana, mês e ano** a partir das linhas de dia da própria planilha
- Envia **e-mail diário** (18h) e **e-mail semanal** (sábado) com ranking de produtividade,
  atendimentos, agendamentos e tarefas em destaque
- Detecta **anomalias** (sem nível, sem responsável, sem data de vencimento) e as mantém
  no e-mail até serem corrigidas no ClickUp
- Corrige automaticamente dias com anomalia resolvida (semana/mês/ano se ajustam sozinhos)

---

## ⚙️ Como funciona

| Horário (Campo Grande) | Função | O que faz |
|---|---|---|
| **23:59** (diário) | `main()` | Busca as tarefas concluídas no dia, grava na linha do dia, recalcula semana/mês/ano e atualiza o Controle |
| **18:00** (diário) | `enviarAlertas()` | Envia o e-mail de relatório (diário; semanal aos sábados) |

### Estrutura da planilha

- **Coluna A**: datas e rótulos (dias, "Semana X", meses, ano)
- **Blocos de 4 colunas por pessoa**: Nível 1, Nível 2, Nível 3, Total
- **Colunas do Setor**: Nível 1, Nível 2, Nível 3, Total
- Linhas **"Semana X"** ficam **entre os dias** (antes dos dias da semana)
- Linhas de **mês** e **ano** são somadas a partir das linhas de dia
- Colunas auxiliares à direita (data/semana/mês) são **preservadas** pelo script

### Regras de preenchimento

- **Zero demandas em dia de descanso** (sábado/domingo/feriado) → `DR`
- **Zero demandas em dia útil** → `FR`
- **Semana toda sem demandas** em dias úteis → `FR`
- **Agendamentos** têm tag de dificuldade e contam normalmente na planilha

---

## 🚀 Instalação

1. Abra a planilha → **Extensões → Apps Script**
2. Apague o conteúdo padrão e **cole o `Code.gs`** inteiro
3. **Salve** (Ctrl+S / Cmd+S)
4. Rode **`setupTrigger()`** uma vez (cria os gatilhos automáticos)
5. Autorize as permissões quando o Google pedir (ClickUp, e-mail, planilha)
6. Rode **`main()`** manualmente para testar a primeira gravação

> ⚠️ Confira se a **última função do arquivo é `normalize`** — isso garante que o
> código foi colado por inteiro.

---

## ⚙️ Configuração

### 1. Aba "Config" (na planilha)

Criada automaticamente pelo `main()`. Edite apenas a **coluna B**:

| Seção | O que editar |
|---|---|
| **RESPONSÁVEIS** | Nome exato no ClickUp → apelido usado nas colunas da planilha |
| **TAGS DE DIFICULDADE** | Nome exato da tag → nível (1, 2 ou 3) |

Depois de editar, rode `main()` (ou `enviarAlertas()`) para o script ler os novos valores.

### 2. Objeto `CONFIG` (no código)

| Chave | O que controla |
|---|---|
| `CLICKUP_API_TOKEN` | Token da API do ClickUp |
| `LIST_IDS` | IDs das listas monitoradas |
| `SHEETS` | Nomes das abas por ano |
| `ASSIGNEES` | Mapeamento responsável → apelido (fallback se a aba Config não existir) |
| `TAGS` | Mapeamento tag → nível (fallback) |
| `PRODUTIVIDADE` | Pesos do ranking (N1=1, N2=2, N3=3) |
| `PALAVRAS_CHAVE` | Palavras que destacam tarefas importantes no e-mail (ex.: captação, carrinho) |
| `ATENDIMENTO_PREFIXOS` | Prefixos de nome contados como atendimentos |
| `AGENDAMENTO_PALAVRA` | Palavra que identifica tarefas de agendamento no e-mail |
| `EMAIL` | Destinatário, horário e se o envio está ativo |
| `REVISAO_STATUS` | Status monitorado como "Revisão Coordenador" |
| `TIMEZONE` | Fuso horário (America/Campo_Grande) |
| `CONTROLE` / `CRIAR_ANOS` | Liga/desliga a aba Controle e a criação automática de abas de ano |

---

## ⏰ Gatilhos (Triggers)

Criados por **`setupTrigger()`**:

| Função | Horário | Frequência |
|---|---|---|
| `main` | 23:59 | Diária |
| `enviarAlertas` | 18:00 | Diária |

Para conferir: **Apps Script → ícone de relógio (Acionadores)**.

> Se trocar o script inteiro, rode `setupTrigger()` de novo para recriar os gatilhos.

---

## 🛠️ Manutenção

| Função | O que faz | Quando usar |
|---|---|---|
| `atualizarControleAgora()` | Atualiza só a aba Controle | Após editar a Config |
| `limparData('aaaa-mm-dd')` | Limpa a linha de um dia específico | Para apagar um dia e deixá-lo vazio |
| `reescreverDiasCorrigidos(datas)` | Regrava dias com anomalia corrigida | Automático (chamado pelo `main()`) |
| `recalcularTotais(ano)` | Recalcula semana/mês/ano | Automático (chamado pelo `main()`) |
| `criarAbaConfig()` | Cria/preenche a aba Config | Automático (chamado pelo `main()`) |
| `garantirAbaAno(ano)` | Cria a aba de um ano novo (limpa, com datas) | Automático (chamado pelo `main()`) |

### Anomalias

- **Sem nível de dificuldade** → não conta na planilha, aparece no e-mail
- **Sem responsável** → não conta na planilha, aparece no e-mail
- **Sem data de vencimento** (tarefa concluída) → conta na planilha, mas aparece no e-mail

As anomalias **persistem no e-mail** até serem corrigidas no ClickUp. Quando corrigidas
(ou se a tarefa for excluída), o dia correspondente é **regravado automaticamente** e a
semana/mês/ano se ajustam.

---

## 📁 Estrutura do repositório

```text
demandas-ti-automacao/
├── Code.gs          ← script completo (Google Apps Script)
├── README.md        ← este arquivo
└── CHANGELOG.md     ← histórico de versões
