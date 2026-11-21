(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inline(raw) {
    var text = String(raw);
    text = text.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
    text = text.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([\s\S]+?)__/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<em>$2</em>');
    text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    return text;
  }

  function isTableSeparator(line) {
    return typeof line === 'string' && line.indexOf('|') !== -1 && /^[\s|:-]+$/.test(line) && line.indexOf('-') !== -1;
  }

  function isBlockStart(line, next) {
    if (/^\s*$/.test(line)) return true;
    if (/^\s*```/.test(line)) return true;
    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return true;
    if (/^ {0,3}#{1,6}\s+/.test(line)) return true;
    if (/^>\s?/.test(line)) return true;
    if (/^\s*[-*+]\s+/.test(line)) return true;
    if (/^\s*\d+[.)、]\s+/.test(line)) return true;
    if (/^\s*\|/.test(line) && (isTableSeparator(next) || /^\s*\|/.test(next || ''))) return true;
    return false;
  }

  function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (cell) {
      return cell.trim();
    });
  }

  function buildTable(header, rows) {
    var cols = header.length;
    var html = '<div class="md-table-wrap"><table><thead><tr>';
    header.forEach(function (cell) {
      html += '<th>' + inline(cell) + '</th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach(function (row) {
      html += '<tr>';
      for (var c = 0; c < cols; c += 1) {
        html += '<td>' + inline(row[c] === undefined ? '' : row[c]) + '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function parseList(lines, start, ordered) {
    var marker = ordered ? /^(\s*)\d+[.)、]\s+(.+)$/ : /^(\s*)[-*+]\s+(.+)$/;
    var items = [];
    var i = start;

    while (i < lines.length) {
      var match = lines[i].match(marker);
      if (!match) break;
      var indent = match[1].replace(/\t/g, '  ').length;
      var content = match[2];
      if (indent >= 2 && items.length) {
        items[items.length - 1].children.push(content);
      } else {
        items.push({ text: content, children: [] });
      }
      i += 1;
    }

    var tag = ordered ? 'ol' : 'ul';
    var html = '<' + tag + '>';
    items.forEach(function (item) {
      html += '<li>' + inline(item.text);
      if (item.children.length) {
        html += '<ul class="md-sublist">';
        item.children.forEach(function (child) {
          html += '<li>' + inline(child) + '</li>';
        });
        html += '</ul>';
      }
      html += '</li>';
    });
    html += '</' + tag + '>';

    return { html: html, next: i };
  }

  function render(markdown) {
    var source = escapeHtml(markdown).replace(/\r\n?/g, '\n');
    var lines = source.split('\n');
    var output = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (/^\s*$/.test(line)) {
        i += 1;
        continue;
      }

      if (/^\s*```/.test(line)) {
        var code = [];
        i += 1;
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          code.push(lines[i]);
          i += 1;
        }
        i += 1;
        output.push('<pre><code>' + code.join('\n') + '</code></pre>');
        continue;
      }

      if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        output.push('<hr>');
        i += 1;
        continue;
      }

      var heading = line.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (heading) {
        var level = Math.min(heading[1].length, 6);
        output.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
        i += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        var quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^>\s?/, ''));
          i += 1;
        }
        output.push('<blockquote><p>' + quote.map(inline).join('<br>') + '</p></blockquote>');
        continue;
      }

      var nextLine = lines[i + 1] || '';
      var hasSeparator = isTableSeparator(nextLine);
      if (/^\s*\|/.test(line) && (hasSeparator || /^\s*\|/.test(nextLine))) {
        var header = splitRow(line);
        i += hasSeparator ? 2 : 1;
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i += 1;
        }
        output.push(buildTable(header, rows));
        continue;
      }

      if (/^(\s*)[-*+]\s+/.test(line)) {
        var ul = parseList(lines, i, false);
        output.push(ul.html);
        i = ul.next;
        continue;
      }

      if (/^(\s*)\d+[.)、]\s+/.test(line)) {
        var ol = parseList(lines, i, true);
        output.push(ol.html);
        i = ol.next;
        continue;
      }

      var paragraph = [line.trim()];
      i += 1;
      while (i < lines.length && !isBlockStart(lines[i], lines[i + 1])) {
        paragraph.push(lines[i].trim());
        i += 1;
      }
      output.push('<p>' + paragraph.map(inline).join('<br>') + '</p>');
    }

    return output.join('\n');
  }

  global.MarkdownRenderer = {
    render: render,
    escape: escapeHtml
  };
})(window);