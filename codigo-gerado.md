# Changelog — Automação ClickUp → Google Sheets

## V9 (atual) — Correção automática de dias com anomalia resolvida
- Adicionada `reescreverDiasCorrigidos()`: quando uma anomalia pendente (de qualquer data) é corrigida ou a tarefa é excluída no ClickUp, o dia correspondente é regravado uma única vez; semana/mês/ano se ajustam sozinhos via `recalcularTotais()`.
- Deduplicação de datas: várias anomalias no mesmo dia regravam o dia uma vez só.
- Anomalias continuam persistindo no e-mail até serem corrigidas.

## V8 — Anomalia de vencimento + pendências persistentes
- "Sem vencimento" vira anomalia apenas das tarefas concluídas no período, na mesma lista do e-mail.
- Pendências persistem no e-mail até correção; saem sozinhas quando resolvidas.

## V7 — Agendamento
- Contagem simples de Agendamentos no e-mail (nome contém "Agendamento"), no dia e na semana.
- Agendamento mantém tag de dificuldade e conta normalmente na planilha; fica fora dos destaques.

## V6 — Correções estruturais
- Bug: totais de semana gravados uma linha acima do rótulo "Semana X" (sobre os sábados) — corrigido para gravar NA linha do rótulo, somando todos os dias.
- Bug: limpeza apagava colunas auxiliares à direita — agora limpa só as colunas de demanda.
- Bug: aba do ano seguinte criada sem datas/auxiliares e com rótulo errado — corrigido.
- Removido o mecanismo que regravava dias anteriores.

## V5 — Somente dia atual
- Passa a gravar apenas a linha do dia atual, limpando a linha antes.
- Mês e ano calculados pelas linhas de dia da própria planilha.
- Tarefas com múltiplos responsáveis contam para cada um.

## V4 — Ajustes de conferência e vencimento
- Conferência apenas no sábado (semana que fecha) e no último dia do mês (mês que fecha).
- Anomalia de vencimento passa a ser apenas tarefas sem data de vencimento.
- Adicionada auditoria manual dos últimos 3 meses (só reporta).

## V3 — Melhorias de relatório
- E-mail de sábado vira semanal (semana inteira).
- Tarefas em destaque (N3 multi-responsável + palavras-chave), ranking de produtividade (N1=1, N2=2, N3=3), contagem de atendimentos.
- Anomalia de vencimento em aberto adicionada.

## V2 — Ano manual
- Removido o preenchimento anual; linha 2 das abas de ano passa a ser manual.

## V1 — Versão original
- Automação diária (23:59) + e-mail diário (18:00), gravação por responsável e nível, DR/FR, pendências de anomalias, abas automáticas.