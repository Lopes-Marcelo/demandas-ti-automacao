/**
 * AUTOMAÇÃO CLICKUP → GOOGLE SHEETS (DEMANDAS DIÁRIAS)
 * GATILHOS (Campo Grande): main() 23:59 | enviarAlertas() 18:00
 * main(): grava EXCLUSIVAMENTE a linha do dia atual (limpa as colunas
 * de demanda antes; preserva as auxiliares à direita). NENHUM dia
 * anterior é regravado ROTINEIRAMENTE — EXCETO quando uma anomalia
 * pendente (de qualquer data) é confirmada como corrigida ou a tarefa
 * foi excluída do ClickUp: nesse caso o dia da anomalia é regravado
 * uma única vez (reescreverDiasCorrigidos) e semana/mês/ano se
 * ajustam sozinhos via recalcularTotais.
 * Totais de SEMANA, MÊS e ANO calculados das linhas de dia da própria
 * planilha; totais de semana gravados NA LINHA "Semana X".
 * enviarAlertas(): diário; no SÁBADO vira semanal (ranking N1=1,N2=2,N3=3).
 * Contagens no e-mail: Atendimento 1/2/3 (por prefixo) e AGENDAMENTOS
 * (nome contém "Agendamento").
 * Anomalias (persistem no e-mail até corrigir): sem nível, sem
 * responsável e SEM DATA DE VENCIMENTO (apenas tarefas concluídas).
 * Destaques: N3 multi-responsável OU palavra-chave (Agendamento fora).
 * Abas Config, Controle e do ano seguinte criadas automaticamente.
 */

var CONFIG = {
  CLICKUP_API_TOKEN: 'pk_54943136_EQH5YV54US6073UJLVHFMV7W9G2K2B7E',
  LIST_IDS: ['901700743873'],
  SPREADSHEET_ID: '',
  SHEETS: { 2024: 'planilha_demandas_ti__2024', 2025: 'planilha_demandas_ti__2025', 2026: 'planilha_demandas_ti__2026', 2027: 'planilha_demandas_ti__2027' },
  ASSIGNEES: { 'Marcelo Lopes': 'Marcelo', 'Paulo Lemos': 'Paulo', 'Pedro Ribas': 'Pedro', 'Arthur Estevão Mônaco': 'Arthur', 'Mariana Claro Piccini Piccini': 'Mariana' },
  TAGS: { 'dificuldade - nível 1': 1, 'dificuldade - nível 2': 2, 'dificuldade - nível 3': 3 },
  PRODUTIVIDADE: { 1: 1, 2: 2, 3: 3 },
  // EDITE AQUI: palavras-chave que destacam tarefas importantes no e-mail
  PALAVRAS_CHAVE: ['captação', 'carrinho'],
  ATENDIMENTO_PREFIXOS: ['atendimento 1:', 'atendimento 2:', 'atendimento 3:'],
  // Palavra que identifica tarefas de agendamento (contagem simples no e-mail)
  AGENDAMENTO_PALAVRA: 'agendamento',
  TIMEZONE: 'America/Campo_Grande',
  DATE_COLUMN: 1,
  EMAIL: { TO: 'marcelo.l@avaeducacao.com.br', HOUR: 18, MINUTE: 0, ENABLED: true },
  REVISAO_STATUS: 'Revisão Coordenador',
  CONTROLE: true,
  CRIAR_ANOS: true
};

function getSpreadsheet() {
  return CONFIG.SPREADSHEET_ID ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function hojeFuso() {
  var s = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  return new Date(s + 'T12:00:00');
}

function getSheetForYear(ss, ano) {
  var nome = CONFIG.SHEETS[ano];
  if (nome) { var s = ss.getSheetByName(nome); if (s) return s; }
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var n = String(sheets[i].getName());
    var low = n.toLowerCase();
    if (low.indexOf('config') >= 0 || low.indexOf('controle') >= 0) continue;
    if (n.indexOf(String(ano)) >= 0) return sheets[i];
  }
  return null;
}

function listarAbas(ss) {
  return ss.getSheets().map(function (s) { return '"' + s.getName() + '"'; }).join(' | ');
}

function getWeekStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay(), 12);
}

// Última coluna de demanda (Setor Total) — colunas além dela são auxiliares
function faixaDemandas(colMap) {
  var max = 1;
  Object.keys(colMap).forEach(function (k) { if (colMap[k] > max) max = colMap[k]; });
  return max;
}

// Nome normalizado contém "Agendamento"?
function ehAgendamento(nomeNormalizado) {
  return nomeNormalizado.indexOf(normalize(CONFIG.AGENDAMENTO_PALAVRA)) >= 0;
}

// ================= MAIN (gatilho 23:59) =================
function main() {
  var hoje = hojeFuso();
  var ss = getSpreadsheet();
  try { criarAbaConfig(); } catch (e) { Logger.log('ERRO na Config: ' + e.message); }
  if (CONFIG.CRIAR_ANOS) {
    try { garantirAbaAno(hoje.getFullYear()); } catch (e) { Logger.log('ERRO aba ' + hoje.getFullYear() + ': ' + e.message); }
    try { garantirAbaAno(hoje.getFullYear() + 1); } catch (e) { Logger.log('ERRO aba ' + (hoje.getFullYear() + 1) + ': ' + e.message); }
  }
  aplicarConfig();
  var diasCorrigidos = [];
  try {
    var tasks = getTasksClosedOn(hoje);
    var result = countTasks(tasks);
    // Pendências: rastreia para o e-mail. Se corrigida (ou tarefa excluída),
    // o dia da anomalia é regravado UMA vez — qualquer que seja a data dela.
    var pending = getPendingAnomalies();
    result.anomalies.forEach(function (a) {
      var ja = pending.some(function (p) { return p.taskId === a.taskId && p.type === a.type; });
      if (!ja) pending.push(a);
    });
    var aindaPendentes = [];
    pending.forEach(function (item) {
      var task = null;
      var ok = false;
      var removida = false;
      try {
        task = getTaskById(item.taskId);
        if (!task) removida = true;
        else ok = isTaskOk(task, item.type);
      } catch (e) { ok = false; }
      if (ok) {
        Logger.log('Corrigida no ClickUp: ' + (item.name || item.taskId));
        diasCorrigidos.push(item.date);
      } else if (removida) {
        Logger.log('Tarefa excluída do ClickUp: ' + (item.name || item.taskId));
        diasCorrigidos.push(item.date);
      } else {
        aindaPendentes.push(item);
      }
    });
    savePendingAnomalies(aindaPendentes);
    writeToSheet(result, hoje);
    Logger.log('Dia ' + fmt(hoje) + ': ' + tasks.length + ' tarefas+subtarefas | ' + JSON.stringify(result.counts));
    logAnomalies(result, aindaPendentes);
  } catch (e) {
    Logger.log('ERRO no preenchimento diário: ' + e.message);
  }
  // Regrava APENAS os dias com anomalia corrigida/tarefa excluída
  if (diasCorrigidos.length > 0) reescreverDiasCorrigidos(diasCorrigidos);
  try { recalcularTotais(hoje.getFullYear()); } catch (e) { Logger.log('ERRO nos totais: ' + e.message); }
  try { atualizarControle(hoje); } catch (e) { Logger.log('ERRO no Controle: ' + e.message); }
}

// Reescreve APENAS os dias em que uma anomalia foi corrigida (ou a
// tarefa excluída) no ClickUp. Deduplica as datas. Semana, mês e ano
// são ajustados automaticamente pelo recalcularTotais (roda logo depois
// no main e soma tudo a partir das linhas de dia).
function reescreverDiasCorrigidos(dates) {
  var unicas = {};
  dates.forEach(function (d) { if (d) unicas[d] = true; });
  Object.keys(unicas).forEach(function (dataStr) {
    try {
      var d = new Date(dataStr + 'T12:00:00');
      var tasks = getTasksClosedOn(d);
      writeToSheet(countTasks(tasks), d);
      Logger.log('Dia corrigido regravado: ' + dataStr + ' (' + tasks.length + ' tarefa(s)).');
    } catch (e) {
      Logger.log('ERRO ao regravar dia corrigido ' + dataStr + ': ' + e.message);
    }
  });
}

// ================= ALERTA DIÁRIO/SEMANAL (18:00) =================
function enviarAlertas() {
  if (!CONFIG.EMAIL.ENABLED) return;
  var hoje = hojeFuso();
  aplicarConfig();
  var sabado = hoje.getDay() === 6;
  var iniSemana = getWeekStart(hoje);
  var tasksDia = [];
  try { tasksDia = getTasksClosedOn(hoje); } catch (e) { Logger.log('ERRO na busca do dia: ' + e.message); }
  var tasksSemana = [];
  if (sabado) {
    try { tasksSemana = getTasksClosedInRange(iniSemana, hoje); } catch (e) { Logger.log('ERRO na busca da semana: ' + e.message); }
  }
  var base = sabado ? tasksSemana : tasksDia;
  var result = countTasks(base);
  var erros = [];
  var vistos = {};
  function add(a) { var k = a.taskId + '|' + (a.type || ''); if (!vistos[k]) { vistos[k] = 1; erros.push(a); } }
  result.anomalies.forEach(add);
  getPendingAnomalies().forEach(add);
  var revisao = [];
  try { revisao = getRevisaoTasks(); } catch (e) { Logger.log('ERRO na busca de revisão: ' + e.message); }
  var pessoas = getConfiguredPersons();
  var dataTxt = Utilities.formatDate(hoje, CONFIG.TIMEZONE, 'dd/MM/yyyy');
  var h = [];
  h.push('<h3>' + (sabado ? 'Resumo semanal' : 'Resumo de demandas') + ' — ' + dataTxt + '</h3>');
  h.push('<p><strong>Período: ' + (sabado ? Utilities.formatDate(iniSemana, CONFIG.TIMEZONE, 'dd/MM') + ' a ' : '') + dataTxt + ' | Concluídas: ' + result.total + ' tarefas+subtarefas.</strong></p>');
  h.push('<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse"><tr><th>Colaborador</th><th>Nível 1</th><th>Nível 2</th><th>Nível 3</th><th>Total</th><th>Pontos</th></tr>');
  pessoas.forEach(function (p) {
    var c = getCounts(result, p);
    var tot = c[1] + c[2] + c[3];
    var totTxt = (tot === 0 && !sabado) ? (isRestDay(hoje) ? 'DR' : 'FR') : String(tot);
    h.push('<tr><td>' + p + '</td><td>' + c[1] + '</td><td>' + c[2] + '</td><td>' + c[3] + '</td><td><strong>' + totTxt + '</strong></td><td>' + pontosDe(result, p) + '</td></tr>');
  });
  h.push('<tr><td><strong>Setor</strong></td><td>' + result.setor[1] + '</td><td>' + result.setor[2] + '</td><td>' + result.setor[3] + '</td><td><strong>' + result.setorTot + '</strong></td><td>—</td></tr>');
  h.push('</table>');
  var atDia = contarPorPrefixos(tasksDia, CONFIG.ATENDIMENTO_PREFIXOS);
  h.push('<p>📞 Atendimentos: <strong>' + atDia.total + '</strong> no dia (' + detalheTxt(atDia) + ')' +
    (sabado ? ' | <strong>' + contarPorPrefixos(tasksSemana, CONFIG.ATENDIMENTO_PREFIXOS).total + '</strong> na semana' : '') + '.</p>');
  var agDia = contarPorPalavra(tasksDia, CONFIG.AGENDAMENTO_PALAVRA);
  h.push('<p>📅 Agendamentos: <strong>' + agDia + '</strong> no dia' +
    (sabado ? ' | <strong>' + contarPorPalavra(tasksSemana, CONFIG.AGENDAMENTO_PALAVRA) + '</strong> na semana' : '') + '.</p>');
  var imp = tarefasImportantes(base);
  if (imp.length === 0) {
    h.push('<p>Nenhuma tarefa em destaque no período.</p>');
  } else {
    h.push('<p><strong>⭐ ' + imp.length + ' tarefa(s) em destaque (N3 multi-responsável ou palavras-chave):</strong></p><ul>');
    imp.forEach(function (t) {
      h.push('<li><a href="' + taskLink(t.id) + '">' + escapeHtml(t.name) + '</a> — nível ' + (t.level || '?') + ' — ' + escapeHtml(t.resp || 'sem responsável') + ' — concluída em ' + t.quando + '</li>');
    });
    h.push('</ul>');
  }
  if (sabado) {
    var rank = pessoas.map(function (p) { return { p: p, pts: pontosDe(result, p) }; }).sort(function (a, b) { return b.pts - a.pts; });
    h.push('<p><strong>🏆 Ranking de produtividade (N1=1, N2=2, N3=3):</strong></p><ol>');
    rank.forEach(function (r) { h.push('<li>' + r.p + ' — ' + r.pts + ' pontos</li>'); });
    h.push('</ol>');
  }
  if (erros.length === 0) {
    h.push('<p>✅ Nenhuma anomalia (nível, responsável ou vencimento).</p>');
  } else {
    h.push('<p><strong>⚠️ ' + erros.length + ' tarefa(s) com anomalia (corrija no ClickUp):</strong></p><ul>');
    erros.forEach(function (a) {
      h.push('<li><a href="' + taskLink(a.taskId) + '">' + escapeHtml(a.name || a.taskId) + '</a> — ' + a.date + ' — ' + tipoAnomaliaTxt(a.type) + '</li>');
    });
    h.push('</ul>');
  }
  if (revisao.length === 0) {
    h.push('<p>Nenhuma tarefa em <strong>Revisão Coordenador</strong> neste momento.</p>');
  } else {
    h.push('<p><strong>⏳ ' + revisao.length + ' tarefa(s) em "Revisão Coordenador":</strong></p><ul>');
    revisao.forEach(function (t) { h.push('<li><a href="' + taskLink(t.id) + '">' + escapeHtml(t.name || t.id) + '</a></li>'); });
    h.push('</ul>');
  }
  MailApp.sendEmail({ to: CONFIG.EMAIL.TO, subject: (sabado ? 'Demandas TI - Resumo SEMANAL ' : 'Demandas TI - Resumo diário ') + dataTxt, htmlBody: h.join('') });
  Logger.log('E-mail enviado para ' + CONFIG.EMAIL.TO + ' (' + erros.length + ' anomalia(s), ' + revisao.length + ' em revisão).');
}

function tipoAnomaliaTxt(type) {
  if (type === 'semNivel') return 'sem nível de dificuldade';
  if (type === 'semVencimento') return 'sem data de vencimento';
  return 'sem responsável';
}

function taskLink(id) { return 'https://app.clickup.com/t/' + id; }

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Pontos de produtividade: N1×1 + N2×2 + N3×3
function pontosDe(res, p) {
  var c = getCounts(res, p);
  return c[1] * CONFIG.PRODUTIVIDADE[1] + c[2] * CONFIG.PRODUTIVIDADE[2] + c[3] * CONFIG.PRODUTIVIDADE[3];
}

// Conta tarefas por prefixo de nome (ex.: "Atendimento 1:")
function contarPorPrefixos(tasks, prefixos) {
  var res = { detalhe: {}, total: 0 };
  prefixos.forEach(function (p) { res.detalhe[p] = 0; });
  tasks.forEach(function (t) {
    var nome = normalize(String(t.name || ''));
    prefixos.forEach(function (p) {
      if (nome.indexOf(p) === 0) { res.detalhe[p]++; res.total++; }
    });
  });
  return res;
}

// Conta tarefas cujo nome CONTÉM a palavra (ex.: "Agendamento")
function contarPorPalavra(tasks, palavra) {
  var p = normalize(palavra);
  var n = 0;
  tasks.forEach(function (t) {
    if (normalize(String(t.name || '')).indexOf(p) >= 0) n++;
  });
  return n;
}

// Detalhe legível: "Atendimento 1: 2, Atendimento 2: 2, Atendimento 3: 1"
function detalheTxt(contagem) {
  return Object.keys(contagem.detalhe).map(function (p) {
    var rotulo = p.replace(':', '');
    return rotulo.charAt(0).toUpperCase() + rotulo.slice(1) + ': ' + contagem.detalhe[p];
  }).join(', ');
}

// Importantes: N3 com mais de um responsável OU nome com palavra-chave.
// Tarefas de Agendamento ficam de fora (têm contagem própria no e-mail).
function tarefasImportantes(tasks) {
  var kws = CONFIG.PALAVRAS_CHAVE.map(normalize);
  var out = [];
  tasks.forEach(function (t) {
    var level = null;
    (t.tags || []).forEach(function (tag) { var lv = CONFIG.TAGS[tag.name]; if (lv) level = lv; });
    var nome = normalize(String(t.name || ''));
    if (ehAgendamento(nome)) return;
    var multi = (t.assignees || []).length > 1;
    var temKw = kws.some(function (k) { return k && nome.indexOf(k) >= 0; });
    if ((level === 3 && multi) || temKw) {
      out.push({ id: t.id, name: t.name || t.id, level: level, resp: (t.assignees || []).map(function (a) { return a.username || a.email; }).join(', '), quando: fmt(new Date(parseInt(t.date_closed || '0', 10))) });
    }
  });
  return out;
}

// Revisão Coordenador: tarefas atualizadas nos últimos 30 dias
function getRevisaoTasks() {
  var out = [];
  var gt = Date.now() - 30 * 24 * 60 * 60 * 1000;
  CONFIG.LIST_IDS.forEach(function (listId) {
    var page = 0;
    while (true) {
      var url = baseListUrl(listId) + '&date_updated_gt=' + gt + '&page=' + page;
      var json = JSON.parse(fetchClickUp(url).getContentText());
      if (json.err) throw new Error('Erro ClickUp: ' + json.err);
      if (!json.tasks || json.tasks.length === 0) break;
      json.tasks.forEach(function (t) {
        var st = t.status && t.status.status;
        if (st && normalize(st) === normalize(CONFIG.REVISAO_STATUS)) out.push(t);
      });
      if (json.tasks.length < 100) break;
      page++;
    }
  });
  return out;
}

// ================= AGENDAMENTO =================
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('main').timeBased().atHour(23).nearMinute(59).everyDays(1).inTimezone(CONFIG.TIMEZONE).create();
  ScriptApp.newTrigger('enviarAlertas').timeBased().atHour(CONFIG.EMAIL.HOUR).nearMinute(CONFIG.EMAIL.MINUTE).everyDays(1).inTimezone(CONFIG.TIMEZONE).create();
  Logger.log('Gatilhos criados: main 23:59 + alerta ' + CONFIG.EMAIL.HOUR + ':' + CONFIG.EMAIL.MINUTE + ' (Campo Grande).');
}

// ================= ABAS AUTOMÁTICAS =================
function criarAbaConfig() {
  var ss = getSpreadsheet();
  var s = ss.getSheetByName('Config');
  if (s && s.getLastRow() > 0) return;
  if (!s) s = ss.insertSheet('Config');
  var linhas = [
    ['CONFIGURAÇÃO DA AUTOMAÇÃO — edite apenas os valores (coluna B)', ''],
    ['', ''],
    ['RESPONSÁVEIS — nome exato no ClickUp | apelido na planilha', ''],
    ['Nome exato no ClickUp', 'Apelido na planilha'],
    ['Marcelo Lopes', 'Marcelo'],
    ['Paulo Lemos', 'Paulo'],
    ['Pedro Ribas', 'Pedro'],
    ['Arthur Estevão Mônaco', 'Arthur'],
    ['Mariana Claro Piccini Piccini', 'Mariana'],
    ['', ''],
    ['TAGS DE DIFICULDADE — nome exato da tag | nível', ''],
    ['Nome exato da tag', 'Nível'],
    ['dificuldade - nível 1', 1],
    ['dificuldade - nível 2', 2],
    ['dificuldade - nível 3', 3]
  ];
  s.getRange(1, 1, linhas.length, 2).setValues(linhas);
  s.getRange(1, 1, linhas.length, 1).setFontWeight('bold');
  s.setColumnWidth(1, 280);
  s.setColumnWidth(2, 200);
  Logger.log('Aba Config criada/preenchida.');
}

function aplicarConfig() {
  var ss = getSpreadsheet();
  var s = ss.getSheetByName('Config');
  if (!s) return;
  var last = s.getLastRow();
  if (last < 8) return;
  var vals = s.getRange(1, 1, last, 2).getValues();
  var assignees = {}, tags = {};
  var section = '';
  for (var i = 0; i < vals.length; i++) {
    var a = vals[i][0] ? String(vals[i][0]).trim() : '';
    var b = vals[i][1];
    if (a.indexOf('RESPONS') === 0) { section = 'assign'; continue; }
    if (a.indexOf('TAGS') === 0) { section = 'tags'; continue; }
    if (!a || b === null || b === undefined || b === '') continue;
    if (a === 'Nome exato no ClickUp' || a === 'Nome exato da tag') continue;
    if (section === 'assign') assignees[a] = String(b).trim();
    if (section === 'tags') { var n = Number(b); if (n) tags[a] = n; }
  }
  if (Object.keys(assignees).length > 0) CONFIG.ASSIGNEES = assignees;
  if (Object.keys(tags).length > 0) CONFIG.TAGS = tags;
}

// Cria o ano (ex.: 2027) copiando a estrutura do ano anterior, LIMPA
function garantirAbaAno(ano) {
  var ss = getSpreadsheet();
  if (getSheetForYear(ss, ano)) return;
  var modelo = null;
  for (var a = ano - 1; a >= ano - 3 && !modelo; a--) { modelo = getSheetForYear(ss, a); }
  if (!modelo) { Logger.log('Sem aba modelo para o ano ' + ano + '. Abas: ' + listarAbas(ss)); return; }
  var nomeModelo = modelo.getName();
  var novoNome = nomeModelo.split(String(ano - 1)).join(String(ano));
  if (novoNome === nomeModelo) novoNome = CONFIG.SHEETS[ano] || (nomeModelo + ' ' + ano);
  if (ss.getSheetByName(novoNome)) return;
  var copia = modelo.copyTo(ss);
  copia.setName(novoNome);
  preencherDatasAno(copia, ano);
  Logger.log('Aba "' + novoNome + '" criada LIMPA a partir de "' + nomeModelo + '".');
}

// Limpa a aba do ano e grava as datas novas. Limpa APENAS as colunas de
// demanda — preserva as colunas auxiliares à direita (data/semana/mês).
// Renomeia o rótulo do ano (ex.: "Ano 2026" → "Ano 2027").
function preencherDatasAno(sheet, ano) {
  var last = sheet.getLastRow();
  if (last < 1) return;
  var headerRow = findHeaderRow(sheet);
  var colMap = buildColumnMap(sheet, headerRow);
  var maxCol = faixaDemandas(colMap);
  var colA = sheet.getRange(1, 1, last, 1).getValues();
  for (var i = 0; i < colA.length; i++) {
    var row = i + 1;
    var v = colA[i][0];
    if (isDateCell(v)) {
      var dt = toDate(v);
      var offset = Math.round((dt - new Date(dt.getFullYear(), 0, 1)) / 86400000);
      var nova = new Date(ano, 0, 1 + offset, 12);
      sheet.getRange(row, CONFIG.DATE_COLUMN).setValue(nova);
      sheet.getRange(row, CONFIG.DATE_COLUMN).setNumberFormat('dd/MM/yyyy');
      if (maxCol > 1) sheet.getRange(row, 2, 1, maxCol - 1).clearContent();
    } else if (v !== null && v !== undefined && String(v).length > 0) {
      var n = normalize(String(v));
      if (n.indexOf('ano') === 0) {
        sheet.getRange(row, CONFIG.DATE_COLUMN).setValue(String(v).replace(/\d{4}/, String(ano)));
      }
      if (maxCol > 1) {
        var linha = sheet.getRange(row, 2, 1, maxCol - 1).getValues()[0];
        var temCabecalho = false;
        for (var c = 0; c < linha.length; c++) {
          if (linha[c] && normalize(String(linha[c])).indexOf('nivel') >= 0) { temCabecalho = true; break; }
        }
        if (!temCabecalho) sheet.getRange(row, 2, 1, maxCol - 1).clearContent();
      }
    }
  }
}

// ================= BUSCA NO CLICKUP =================
function baseListUrl(listId) {
  return 'https://api.clickup.com/api/v2/list/' + listId + '/task?include_closed=true&subtasks=true';
}

function fetchClickUp(url) {
  var attempts = 0;
  while (true) {
    attempts++;
    var res = UrlFetchApp.fetch(url, { method: 'get', headers: { 'Authorization': CONFIG.CLICKUP_API_TOKEN }, muteHttpExceptions: true });
    var code = res.getResponseCode();
    if (code === 200) return res;
    if (code === 429 || code >= 500) {
      if (attempts >= 4) throw new Error('ClickUp falhou após retries (HTTP ' + code + ')');
      Utilities.sleep(2000 * attempts);
      continue;
    }
    throw new Error('ClickUp HTTP ' + code);
  }
}

function getTasksClosedOn(targetDate) {
  var tasks = [];
  var seen = {};
  var pages = 0;
  var range = dayRangeMs(targetDate);
  CONFIG.LIST_IDS.forEach(function (listId) {
    var page = 0;
    while (true) {
      var url = baseListUrl(listId) + '&date_done_gt=' + range.gt + '&date_done_lt=' + range.lt + '&page=' + page;
      var json = JSON.parse(fetchClickUp(url).getContentText());
      if (json.err) throw new Error('Erro ClickUp: ' + json.err);
      if (!json.tasks || json.tasks.length === 0) break;
      json.tasks.forEach(function (t) {
        if (isClosedOn(t, targetDate) && !seen[t.id]) { seen[t.id] = true; tasks.push(t); }
      });
      pages++;
      if (json.tasks.length < 100) break;
      page++;
    }
  });
  Logger.log('Busca ' + fmt(targetDate) + ': ' + pages + ' página(s) | ' + tasks.length + ' tarefa(s) únicas.');
  return tasks;
}

function getTasksClosedInRange(inicio, fim) {
  var tasks = [];
  var seen = {};
  var pages = 0;
  var margin = 24 * 60 * 60 * 1000;
  var gt = new Date(fmt(inicio) + 'T00:00:00').getTime() - margin;
  var lt = new Date(fmt(fim) + 'T23:59:59.999').getTime() + margin;
  CONFIG.LIST_IDS.forEach(function (listId) {
    var page = 0;
    while (true) {
      var url = baseListUrl(listId) + '&date_done_gt=' + gt + '&date_done_lt=' + lt + '&page=' + page;
      var json = JSON.parse(fetchClickUp(url).getContentText());
      if (json.err) throw new Error('Erro ClickUp: ' + json.err);
      if (!json.tasks || json.tasks.length === 0) break;
      json.tasks.forEach(function (t) {
        if (isInRange(t, inicio, fim) && !seen[t.id]) { seen[t.id] = true; tasks.push(t); }
      });
      pages++;
      if (json.tasks.length < 100) break;
      page++;
    }
  });
  Logger.log('Busca ' + fmt(inicio) + ' a ' + fmt(fim) + ': ' + pages + ' página(s) | ' + tasks.length + ' tarefa(s) únicas.');
  return tasks;
}

function isInRange(task, inicio, fim) {
  var ms = parseInt(task.date_closed || '0', 10);
  if (!ms) return false;
  var f = fmt(new Date(ms));
  return f >= fmt(inicio) && f <= fmt(fim);
}

function isClosedOn(task, targetDate) {
  var ms = parseInt(task.date_closed || '0', 10);
  if (!ms) return false;
  return fmt(new Date(ms)) === fmt(targetDate);
}

function dayRangeMs(targetDate) {
  var s = fmt(targetDate);
  var start = new Date(s + 'T00:00:00').getTime();
  var end = new Date(s + 'T23:59:59.999').getTime();
  var margin = 3 * 60 * 60 * 1000;
  return { gt: start - margin, lt: end + margin };
}

function fmt(d) {
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

// ================= CONTAGEM =================
// Tarefas/subtarefas com vários responsáveis contam para CADA um.
// Setor: cada tarefa conta UMA vez (independente de responsáveis).
// Anomalias: sem nível, sem responsável e SEM DATA DE VENCIMENTO
// (apenas tarefas concluídas no período). Tarefa sem vencimento mas
// com nível e responsável válidos AINDA CONTA na planilha.
function countTasks(tasks) {
  var counts = {};
  var setor = { 1: 0, 2: 0, 3: 0 };
  var anomalies = [];
  tasks.forEach(function (t) {
    var level = null;
    (t.tags || []).forEach(function (tag) { var lv = CONFIG.TAGS[tag.name]; if (lv) level = lv; });
    var closedDate = fmt(new Date(parseInt(t.date_closed || '0', 10)));
    if (!level) {
      anomalies.push({ taskId: t.id, name: t.name || t.id, date: closedDate, type: 'semNivel' });
      return;
    }
    if (!t.due_date) {
      anomalies.push({ taskId: t.id, name: t.name || t.id, date: closedDate, type: 'semVencimento' });
    }
    setor[level]++;
    var assignees = t.assignees || [];
    if (assignees.length === 0) {
      anomalies.push({ taskId: t.id, name: t.name || t.id, date: closedDate, type: 'semResponsavel' });
      return;
    }
    assignees.forEach(function (a) {
      var col = CONFIG.ASSIGNEES[a.username] || CONFIG.ASSIGNEES[a.email];
      if (!col) return;
      var key = normalize(col);
      if (!counts[key]) counts[key] = { 1: 0, 2: 0, 3: 0 };
      counts[key][level]++;
    });
  });
  return { counts: counts, setor: setor, setorTot: setor[1] + setor[2] + setor[3], anomalies: anomalies, total: tasks.length };
}

function getCounts(res, p) {
  return res.counts[normalize(String(p))] || { 1: 0, 2: 0, 3: 0 };
}

// ================= PENDÊNCIAS (persistem no e-mail até serem corrigidas) =================
function getPendingAnomalies() {
  var raw = PropertiesService.getScriptProperties().getProperty('PENDING_ANOMALIES');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

function savePendingAnomalies(list) {
  PropertiesService.getScriptProperties().setProperty('PENDING_ANOMALIES', JSON.stringify(list || []));
}

function getTaskById(taskId) {
  var url = 'https://api.clickup.com/api/v2/task/' + taskId;
  var attempts = 0;
  while (true) {
    attempts++;
    var res = UrlFetchApp.fetch(url, { method: 'get', headers: { 'Authorization': CONFIG.CLICKUP_API_TOKEN }, muteHttpExceptions: true });
    var code = res.getResponseCode();
    if (code === 200) {
      var json = JSON.parse(res.getContentText());
      if (json.err) throw new Error('Erro ClickUp: ' + json.err);
      return json;
    }
    if (code === 404) return null;
    if (code === 429 || code >= 500) {
      if (attempts >= 4) throw new Error('ClickUp falhou (HTTP ' + code + ')');
      Utilities.sleep(2000 * attempts);
      continue;
    }
    throw new Error('ClickUp HTTP ' + code);
  }
}

function isTaskOk(task, type) {
  if (type === 'semNivel') {
    var level = null;
    (task.tags || []).forEach(function (tag) { var lv = CONFIG.TAGS[tag.name]; if (lv) level = lv; });
    return !!level;
  }
  if (type === 'semVencimento') return !!task.due_date;
  if (type === 'semResponsavel') return (task.assignees || []).length > 0;
  return true;
}

function logAnomalies(result, pendentes) {
  var anomalias = result.anomalies || [];
  if (anomalias.length > 0) {
    Logger.log('ATENÇÃO — ' + anomalias.length + ' tarefa(s) com problema:');
    anomalias.forEach(function (a) {
      Logger.log('  [' + a.date + '] ' + (a.name || a.taskId) + ' (' + taskLink(a.taskId) + ') → ' + tipoAnomaliaTxt(a.type));
    });
  }
  if (pendentes && pendentes.length > 0) {
    Logger.log('PENDENTES — ' + pendentes.length + ' anomalia(s) ainda não corrigida(s).');
  }
}

// ================= ABA CONTROLE =================
function safeCount(inicio, fim) {
  try {
    return countTasks(getTasksClosedInRange(inicio, fim));
  } catch (e) {
    Logger.log('ERRO na consulta de período: ' + e.message);
    return { counts: {}, setor: { 1: 0, 2: 0, 3: 0 }, setorTot: 0, anomalies: [], total: 0 };
  }
}

function somasParaRes(somas) {
  var res = { counts: {}, setor: { 1: 0, 2: 0, 3: 0 }, setorTot: 0, anomalies: [], total: 0 };
  Object.keys(somas).forEach(function (k) {
    var parts = k.split('|');
    if (parts[0] === 'setor') {
      if (parts[1] !== 'total') res.setor[parts[1]] = somas[k];
    } else {
      if (!res.counts[parts[0]]) res.counts[parts[0]] = { 1: 0, 2: 0, 3: 0 };
      if (parts[1] !== 'total') res.counts[parts[0]][parts[1]] = somas[k];
    }
  });
  res.setorTot = res.setor[1] + res.setor[2] + res.setor[3];
  return res;
}

// Lê MÊS e ANO das linhas da própria aba (já calculados pelo script)
function lerTotaisDaAba(sheet, colMap, hoje) {
  var last = sheet.getLastRow();
  var colA = sheet.getRange(1, 1, last, 1).getValues();
  var mesNome = MESES[hoje.getMonth()];
  var mesRow = null, anoRow = null;
  for (var r = 1; r <= last; r++) {
    var tipo = classificarLinha(colA[r - 1][0]);
    if (tipo === 'month' && normalize(String(colA[r - 1][0])) === mesNome && mesRow === null) mesRow = r;
    if (tipo === 'year' && anoRow === null) anoRow = r;
  }
  function lerLinha(row) {
    var somas = {};
    Object.keys(colMap).forEach(function (k) { somas[k] = 0; });
    if (!row) return somas;
    Object.keys(colMap).forEach(function (k) {
      var v = sheet.getRange(row, colMap[k]).getValue();
      if (typeof v === 'number' && isFinite(v)) somas[k] = v;
    });
    return somas;
  }
  return { mes: somasParaRes(lerLinha(mesRow)), ano: somasParaRes(lerLinha(anoRow)) };
}

function atualizarControleAgora() {
  aplicarConfig();
  atualizarControle(hojeFuso());
}

function atualizarControle(hoje) {
  if (!CONFIG.CONTROLE) return;
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Controle');
  if (!sheet) sheet = ss.insertSheet('Controle');
  sheet.clear();
  var agora = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
  var pessoas = getConfiguredPersons();
  try {
    var _aba = getSheetForYear(ss, hoje.getFullYear());
    if (_aba) {
      var _map = buildColumnMap(_aba, findHeaderRow(_aba));
      var _ordem = getPersonsFromMap(_map).filter(function (p) { return p !== 'setor'; }).map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); });
      if (_ordem.length > 0) pessoas = _ordem;
    }
  } catch (e) { /* mantém a ordem da Config */ }
  var diaI = new Date(hoje); var diaF = new Date(hoje);
  var semanaI = getWeekStart(hoje); var semanaF = new Date(semanaI.getFullYear(), semanaI.getMonth(), semanaI.getDate() + 6, 12);
  var dRes = safeCount(diaI, diaF);
  var sRes = safeCount(semanaI, semanaF);
  var mRes = { counts: {}, setor: { 1: 0, 2: 0, 3: 0 }, setorTot: 0, anomalies: [], total: 0 };
  var aRes = { counts: {}, setor: { 1: 0, 2: 0, 3: 0 }, setorTot: 0, anomalies: [], total: 0 };
  var abaAno = getSheetForYear(ss, hoje.getFullYear());
  if (abaAno) {
    try {
      var headerRow = findHeaderRow(abaAno);
      var colMap = buildColumnMap(abaAno, headerRow);
      var tot = lerTotaisDaAba(abaAno, colMap, hoje);
      mRes = tot.mes;
      aRes = tot.ano;
    } catch (e) { Logger.log('ERRO ao ler totais da aba: ' + e.message); }
  }
  var restDay = isRestDay(hoje);
  function resTot(res, p) { var c = getCounts(res, p); return c[1] + c[2] + c[3]; }
  function valor(res, p, lv) { return getCounts(res, p)[lv]; }
  var cab = ['Período', 'Métrica'].concat(pessoas).concat(['Setor']);
  var largura = cab.length;
  function pad(arr) { var r = arr.slice(); while (r.length < largura) r.push(''); return r; }
  var linhas = [];
  linhas.push(pad(['Controle de demandas — atualizado em ' + agora]));
  linhas.push(pad(['']));
  var df = function (d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, 'dd/MM'); };
  linhas.push(cab);
  linhas.push(['Dia (' + df(diaI) + ')', 'N1'].concat(pessoas.map(function (p) { return valor(dRes, p, 1); })).concat([dRes.setor[1]]));
  linhas.push(['', 'N2'].concat(pessoas.map(function (p) { return valor(dRes, p, 2); })).concat([dRes.setor[2]]));
  linhas.push(['', 'N3'].concat(pessoas.map(function (p) { return valor(dRes, p, 3); })).concat([dRes.setor[3]]));
  linhas.push(['', 'Total'].concat(pessoas.map(function (p) { return resTot(dRes, p) === 0 ? (restDay ? 'DR' : 'FR') : resTot(dRes, p); })).concat([dRes.setorTot === 0 ? (restDay ? 'DR' : 0) : dRes.setorTot]));
  linhas.push(['Semana (' + df(semanaI) + ' a ' + df(semanaF) + ')', 'Total'].concat(pessoas.map(function (p) { return resTot(sRes, p); })).concat([sRes.setorTot]));
  linhas.push(['Mês (' + Utilities.formatDate(hoje, CONFIG.TIMEZONE, 'MM/yyyy') + ')', 'Total'].concat(pessoas.map(function (p) { return resTot(mRes, p); })).concat([mRes.setorTot]));
  linhas.push(['Ano (' + hoje.getFullYear() + ')', 'Total'].concat(pessoas.map(function (p) { return resTot(aRes, p); })).concat([aRes.setorTot]));
  sheet.getRange(1, 1, linhas.length, largura).setValues(linhas);
  sheet.getRange(3, 1, 1, largura).setFontWeight('bold');
  sheet.getRange(1, 1, 1, largura).mergeAcross().setFontWeight('bold');
  Logger.log('Controle atualizado (' + agora + ').');
}

// ================= GRAVAÇÃO DIÁRIA (só o dia atual; limpa antes) =================
function writeToSheet(result, targetDate) {
  var year = targetDate.getFullYear();
  var ss = getSpreadsheet();
  var sheet = getSheetForYear(ss, year);
  if (!sheet) throw new Error('Aba do ano ' + year + ' não encontrada. Abas: ' + listarAbas(ss));
  var headerRow = findHeaderRow(sheet);
  var colMap = buildColumnMap(sheet, headerRow);
  var row = findDateRow(sheet, targetDate);
  if (!row) throw new Error('Linha da data não encontrada: ' + fmt(targetDate));
  // Limpa APENAS as colunas de demanda — preserva as auxiliares à direita
  var maxCol = faixaDemandas(colMap);
  if (maxCol > 1) sheet.getRange(row, 2, 1, maxCol - 1).clearContent();
  var updates = {};
  Object.keys(result.counts).forEach(function (person) {
    var c = result.counts[person];
    [1, 2, 3].forEach(function (lv) {
      var col = colMap[person + '|' + lv];
      if (col) updates[col] = (updates[col] || 0) + c[lv];
    });
    var totalCol = colMap[person + '|total'];
    if (totalCol) updates[totalCol] = (updates[totalCol] || 0) + c[1] + c[2] + c[3];
  });
  [1, 2, 3].forEach(function (lv) {
    var col = colMap['setor|' + lv];
    if (col) updates[col] = (updates[col] || 0) + result.setor[lv];
  });
  var setorTotalCol = colMap['setor|total'];
  if (setorTotalCol) updates[setorTotalCol] = (updates[setorTotalCol] || 0) + result.setor[1] + result.setor[2] + result.setor[3];
  var restDay = isRestDay(targetDate);
  var persons = getPersonsFromMap(colMap);
  persons.forEach(function (person) {
    if (person === 'setor') return;
    var total = 0;
    if (result.counts[person]) total = result.counts[person][1] + result.counts[person][2] + result.counts[person][3];
    if (total === 0) {
      var status = restDay ? 'DR' : 'FR';
      [1, 2, 3].forEach(function (lv) {
        var col = colMap[person + '|' + lv];
        if (col) updates[col] = status;
      });
      var totalCol = colMap[person + '|total'];
      if (totalCol) updates[totalCol] = status;
    }
  });
  if (result.setorTot === 0 && restDay) {
    [1, 2, 3].forEach(function (lv) {
      var col = colMap['setor|' + lv];
      if (col) updates[col] = 'DR';
    });
    if (setorTotalCol) updates[setorTotalCol] = 'DR';
  }
  Object.keys(updates).forEach(function (col) {
    sheet.getRange(row, col).setValue(updates[col]);
  });
  Logger.log('Linha ' + row + ' de ' + fmt(targetDate) + ' gravada: ' + JSON.stringify(updates));
}

// ================= TOTAIS DE SEMANA, MÊS E ANO =================
// Semanas: a linha "Semana X" fica ENTRE os dias; totais gravados NA
// LINHA do rótulo, somando TODOS os dias da semana (sábado inclusive).
// MÊS e ANO: somados das linhas de dia da PRÓPRIA planilha.
var MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function isDateCell(v) {
  return (v instanceof Date) || (typeof v === 'number' && v > 20000 && v < 80000);
}

// Converte para meio-dia de Campo Grande — elimina bugs de borda de meia-noite
function toDate(v) {
  var ssTz = getSpreadsheet().getSpreadsheetTimeZone();
  var d = (v instanceof Date) ? new Date(v.getTime()) : new Date(Math.round((v - 25569) * 86400000));
  var s = Utilities.formatDate(d, ssTz, 'yyyy-MM-dd');
  return new Date(s + 'T12:00:00');
}

function classificarLinha(valor) {
  if (valor === null || valor === undefined) return null;
  if (isDateCell(valor)) return 'day';
  var n = normalize(String(valor));
  if (n.indexOf('semana') >= 0) return 'week';
  if (MESES.indexOf(n) >= 0) return 'month';
  if (n.indexOf('mes') >= 0) return 'month';
  if (n.indexOf('ano') === 0) return 'year';
  if (n.indexOf('total') >= 0) return 'year';
  return null;
}

function recalcularTotais(ano) {
  var ss = getSpreadsheet();
  var sheet = getSheetForYear(ss, ano);
  if (!sheet) return;
  var headerRow = findHeaderRow(sheet);
  var colMap = buildColumnMap(sheet, headerRow);
  if (Object.keys(colMap).length === 0) return;
  var last = sheet.getLastRow();
  var colMax = sheet.getLastColumn();
  var colA = sheet.getRange(1, 1, last, 1).getValues();
  var valores = sheet.getRange(headerRow + 1, 1, Math.max(last - headerRow, 1), colMax).getValues();

  // 1) Mês e Ano: soma das linhas de dia da própria planilha
  var somaMes = {};
  var somaAno = {};
  Object.keys(colMap).forEach(function (k) { somaAno[k] = 0; });
  for (var i = 0; i < valores.length; i++) {
    var v = colA[headerRow + i][0];
    if (!isDateCell(v)) continue;
    var dt = toDate(v);
    var mi = dt.getMonth();
    if (!somaMes[mi]) {
      somaMes[mi] = {};
      Object.keys(colMap).forEach(function (k) { somaMes[mi][k] = 0; });
    }
    Object.keys(colMap).forEach(function (k) {
      var x = valores[i][colMap[k] - 1];
      if (typeof x === 'number' && isFinite(x)) {
        somaMes[mi][k] += x;
        somaAno[k] += x;
      }
    });
  }

  // 2) Semanas: fecha cada semana com os dias seguintes ao rótulo,
  //    até a linha anterior ao próximo rótulo/mês/ano. Grava NO rótulo.
  function fecharSemana(rowSemana, rowIni, rowFim) {
    if (rowFim < rowIni) return;
    var res = somarIntervalo(sheet, colMap, rowIni, rowFim);
    gravarTotaisSemana(sheet, rowSemana, colMap, res.somas, res.dias);
  }
  var semanaRow = null; // linha REAL da planilha do rótulo "Semana X" pendente
  for (var i2 = 0; i2 < valores.length; i2++) {
    var tipo = classificarLinha(colA[headerRow + i2][0]);
    var rowAtual = headerRow + i2 + 1; // linha real deste índice de colA
    if (tipo === 'week') {
      if (semanaRow !== null) fecharSemana(semanaRow, semanaRow + 1, rowAtual - 1);
      semanaRow = rowAtual;
    } else if (tipo === 'month' || tipo === 'year') {
      if (semanaRow !== null) {
        fecharSemana(semanaRow, semanaRow + 1, rowAtual - 1);
        semanaRow = null;
      }
    }
  }
  if (semanaRow !== null) fecharSemana(semanaRow, semanaRow + 1, last);

  // 3) Mês e Ano: grava nas linhas correspondentes (pelo rótulo)
  for (var r2 = headerRow + 1; r2 <= last; r2++) {
    var tipo2 = classificarLinha(colA[r2 - 1][0]);
    if (tipo2 === 'month') {
      var mi2 = MESES.indexOf(normalize(String(colA[r2 - 1][0])));
      if (mi2 >= 0 && somaMes[mi2] && !isLabelRow(sheet, r2, colMap)) {
        gravarTotaisPeriodo(sheet, r2, colMap, somaMes[mi2]);
      }
    } else if (tipo2 === 'year') {
      if (!isLabelRow(sheet, r2, colMap)) {
        gravarTotaisPeriodo(sheet, r2, colMap, somaAno);
      }
    }
  }
  Logger.log('Totais recalculados (semanas + meses + ano) a partir das linhas de dia.');
}

function somarIntervalo(sheet, colMap, inicio, fim) {
  var colMax = sheet.getLastColumn();
  var valores = sheet.getRange(inicio, 1, fim - inicio + 1, colMax).getValues();
  var colas = sheet.getRange(inicio, 1, fim - inicio + 1, 1).getValues();
  var somas = {};
  Object.keys(colMap).forEach(function (k) { somas[k] = 0; });
  var dias = [];
  for (var i = 0; i < valores.length; i++) {
    if (!isDateCell(colas[i][0])) continue;
    dias.push({ row: inicio + i, dt: toDate(colas[i][0]) });
    Object.keys(colMap).forEach(function (k) {
      var v = valores[i][colMap[k] - 1];
      if (typeof v === 'number' && isFinite(v)) somas[k] += v;
    });
  }
  return { somas: somas, dias: dias };
}

// Semana: níveis somados; Total derivado (N1+N2+N3); FR se todos os dias úteis FR
function gravarTotaisSemana(sheet, row, colMap, somas, dias) {
  var pessoas = getPersonsFromMap(colMap);
  pessoas.forEach(function (p) {
    if (p === 'setor') return;
    var totalCol = colMap[p + '|total'];
    var somaTotal = (somas[p + '|1'] || 0) + (somas[p + '|2'] || 0) + (somas[p + '|3'] || 0);
    if (somaTotal === 0 && totalCol && semanaTodaFR(sheet, dias, totalCol)) {
      [1, 2, 3].forEach(function (lv) {
        var c = colMap[p + '|' + lv];
        if (c) sheet.getRange(row, c).setValue('FR');
      });
      sheet.getRange(row, totalCol).setValue('FR');
    } else {
      [1, 2, 3].forEach(function (lv) {
        var c = colMap[p + '|' + lv];
        if (c) sheet.getRange(row, c).setValue(somas[p + '|' + lv] || 0);
      });
      if (totalCol) sheet.getRange(row, totalCol).setValue(somaTotal);
    }
  });
  [1, 2, 3].forEach(function (lv) {
    var c = colMap['setor|' + lv];
    if (c) sheet.getRange(row, c).setValue(somas['setor|' + lv] || 0);
  });
  var st = colMap['setor|total'];
  if (st) sheet.getRange(row, st).setValue((somas['setor|1'] || 0) + (somas['setor|2'] || 0) + (somas['setor|3'] || 0));
}

function semanaTodaFR(sheet, dias, colTotal) {
  if (!dias || dias.length === 0) return false;
  var temDiaUtil = false;
  for (var i = 0; i < dias.length; i++) {
    if (isRestDay(dias[i].dt)) continue;
    temDiaUtil = true;
    var v = sheet.getRange(dias[i].row, colTotal).getValue();
    if (v !== 'FR') return false;
  }
  return temDiaUtil;
}

// Mês e Ano: níveis somados; Total derivado (N1+N2+N3)
function gravarTotaisPeriodo(sheet, row, colMap, somas) {
  Object.keys(colMap).forEach(function (k) {
    var parts = k.split('|');
    var c = colMap[k];
    if (parts[1] === 'total') {
      var soma = (somas[parts[0] + '|1'] || 0) + (somas[parts[0] + '|2'] || 0) + (somas[parts[0] + '|3'] || 0);
      sheet.getRange(row, c).setValue(soma);
    } else {
      sheet.getRange(row, c).setValue(somas[k] || 0);
    }
  });
}

function isLabelRow(sheet, row, colMap) {
  var primeiro = null;
  for (var k in colMap) { primeiro = colMap[k]; break; }
  if (!primeiro) return false;
  var v = sheet.getRange(row, primeiro).getValue();
  if (typeof v === 'string') {
    var n = normalize(v);
    if (n.indexOf('nivel') >= 0 || n.indexOf('total') >= 0) return true;
  }
  return false;
}

// ================= CABEÇALHOS E LINHAS =================
function getPersonsFromMap(colMap) {
  var persons = {};
  Object.keys(colMap).forEach(function (key) {
    var parts = key.split('|');
    if (parts.length === 2 && parts[1] !== 'total') persons[parts[0]] = true;
  });
  return Object.keys(persons);
}

function getConfiguredPersons() {
  var persons = [];
  var seen = {};
  Object.keys(CONFIG.ASSIGNEES).forEach(function (k) {
    var nome = String(CONFIG.ASSIGNEES[k]).trim();
    if (nome && !seen[nome]) { seen[nome] = 1; persons.push(nome); }
  });
  return persons;
}

function findHeaderRow(sheet) {
  var limit = Math.min(sheet.getLastRow(), 15);
  for (var r = 1; r <= limit; r++) {
    var values = sheet.getRange(r, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var c = 0; c < values.length; c++) {
      if (values[c] && normalize(String(values[c])).indexOf('nivel') >= 0) return r;
    }
  }
  throw new Error('Linha de cabeçalhos não encontrada na aba ' + sheet.getName());
}

function buildColumnMap(sheet, headerRow) {
  var headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  headers.forEach(function (h, idx) {
    if (!h) return;
    var n = normalize(String(h));
    var m = n.match(/^(.+?)\s*-\s*(nivel\s*[123]|total)$/);
    if (m) {
      var person = normalize(m[1].trim());
      var key = m[2].indexOf('nivel') === 0 ? m[2].replace('nivel ', '') : 'total';
      map[person + '|' + key] = idx + 1;
    }
  });
  return map;
}

// Compara as datas no fuso da PRÓPRIA planilha — evita deslocamento de dia
function findDateRow(sheet, targetDate) {
  var last = sheet.getLastRow();
  var target = fmt(targetDate);
  var ssTz = getSpreadsheet().getSpreadsheetTimeZone();
  var values = sheet.getRange(1, CONFIG.DATE_COLUMN, last, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var v = values[i][0];
    if (!v) continue;
    var s = (v instanceof Date) ? Utilities.formatDate(v, ssTz, 'yyyy-MM-dd') : String(v).substring(0, 10);
    if (s === target) return i + 1;
  }
  return null;
}

// ================= FERIADOS =================
function isRestDay(date) {
  var day = date.getDay();
  if (day === 0 || day === 6) return true;
  return isHolidayCampoGrande(date);
}

function isHolidayCampoGrande(date) {
  var m = date.getMonth() + 1;
  var d = date.getDate();
  var fixed = { '1-1': true, '4-21': true, '5-1': true, '9-7': true, '10-12': true, '11-2': true, '11-15': true, '11-20': true, '12-25': true, '8-26': true };
  if (fixed[m + '-' + d]) return true;
  var easter = getEaster(date.getFullYear());
  var carnaval = new Date(easter); carnaval.setDate(carnaval.getDate() - 47);
  var sextaSanta = new Date(easter); sextaSanta.setDate(sextaSanta.getDate() - 2);
  var corpusChristi = new Date(easter); corpusChristi.setDate(corpusChristi.getDate() + 60);
  var mov = [carnaval, sextaSanta, corpusChristi, new Date(easter)];
  for (var i = 0; i < mov.length; i++) {
    if (mov[i].getFullYear() === date.getFullYear() && mov[i].getMonth() === date.getMonth() && mov[i].getDate() === date.getDate()) return true;
  }
  return false;
}

function getEaster(year) {
  var a = year % 19, b = Math.floor(year / 100), c = year % 100;
  var d = Math.floor(b / 4), e = b % 4;
  var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  var h = (19 * a + b - d - g + 15) % 30;
  var i = Math.floor(c / 4), k = c % 4;
  var l = (32 + 2 * e + 2 * i - h - k) % 7;
  var m = Math.floor((a + 11 * h + 22 * l) / 451);
  var month = Math.floor((h + l - 7 * m + 114) / 31);
  var day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}