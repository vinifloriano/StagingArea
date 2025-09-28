// DevExtreme jQuery implementation for a visual query builder over mock data
(function () {
  var selectedTables = []; // ['users', 'orders']
  var selectedColumnsByTable = {}; // { users: ['id','name'], orders: ['id'] }
  var groupBy = []; // [{ table:'users', column:'country' }]
  var orderBy = []; // [{ table:'orders', column:'amount', desc:false }]
  var aggregates = []; // [{ table, column, func, alias }]
  var filterExpr = null; // DevExtreme filter expression (array)
  var joins = []; // [{ leftTable, leftColumn, rightTable, rightColumn, type }]
  var instances = {
    tablesTagBox: null,
    joinConfigBtn: null,
    filterBtn: null,
    filterPopup: null,
    filterBuilder: null,
    filterApplyBtn: null,
    filterClearBtn: null,
    joinPopup: null,
    joinGrid: null,
    joinSaveBtn: null,
    joinCancelBtn: null,
    previewGrid: null,
    limitCount: null,
    limitOffset: null,
    aliasPopup: null,
    aliasEditor: null,
    aliasSaveBtn: null,
    aliasCancelBtn: null,
  };
  var aliasEditState = { table: null, column: null, alias: '' };
  var limitState = { count: 50, offset: 0 };

  function getEl(id) {
    return document.getElementById(id);
  }

  function fieldKey(path) {
    return String(path).replace(/\./g, '__');
  }

  function sanitizeRowKeys(row) {
    var out = {};
    Object.keys(row).forEach(function (k) { out[fieldKey(k)] = row[k]; });
    return out;
  }

  function init() {
    initTablesSelector();
    initJoinPopup();
    initFilterPopup();
    initAliasPopup();
    renderKanban();
    initPreviewGrid();
  }

  function initTablesSelector() {
    var tableOptions = window.MockSchema.tables.map(function (t) {
      return { id: t.name, name: t.name };
    });

    var tablesEl = getEl('tablesSelector');
    if (!tablesEl) return;

    instances.tablesTagBox = new DevExpress.ui.dxTagBox(tablesEl, {
      dataSource: tableOptions,
      valueExpr: 'id',
      displayExpr: 'name',
      showSelectionControls: true,
      applyValueMode: 'useButtons',
      placeholder: 'Select tables...',
      width: 420,
      dropDownOptions: { height: 360, width: 420 },
      maxDisplayedTags: 6,
      multiline: true,
      onValueChanged: function (e) {
        var previous = selectedTables.slice();
        selectedTables = e.value || [];
        // Reset state for deselected tables
        Object.keys(selectedColumnsByTable).forEach(function (t) {
          if (selectedTables.indexOf(t) === -1) delete selectedColumnsByTable[t];
        });
        joins = joins.filter(function (j) {
          return selectedTables.indexOf(j.leftTable) !== -1 && selectedTables.indexOf(j.rightTable) !== -1;
        });
        // Auto-infer a join when adding a new table and default-select all columns
        var added = selectedTables.filter(function (t) { return previous.indexOf(t) === -1; });
        if (added.length > 0) {
          added.forEach(function (t) {
            // default-select all columns for the added table
            var table = window.getTable(t);
            selectedColumnsByTable[t] = table.columns.map(function (c) { return c.name; });
            if (previous.length > 0) {
              var base = previous[previous.length - 1];
              var j = inferJoin(base, t);
              if (!joins.some(function (x) { return x.leftTable === j.leftTable && x.rightTable === j.rightTable && x.leftColumn === j.leftColumn && x.rightColumn === j.rightColumn; })) {
                joins.push(j);
              }
            }
          });
        }
        // Clear filter when changing table set to avoid invalid fields
        filterExpr = null;
        var sumEl = getEl('filterSummary');
        if (sumEl) sumEl.textContent = '';
        if (instances.filterBuilder) instances.filterBuilder.option('value', null);

        $('#joinConfigWrapper').toggle(selectedTables.length > 1);
        renderKanban();
        refreshFilterBuilderFields();
        recomputeAndRender();
      },
    });

    var joinBtnEl = getEl('joinConfigBtn');
    if (joinBtnEl) {
      instances.joinConfigBtn = new DevExpress.ui.dxButton(joinBtnEl, {
        text: 'Configure Joins',
        type: 'default',
        onClick: function () { showJoinPopup(); },
      });
    }

    // Limit controls
    var limitCountEl = getEl('limitCount');
    if (limitCountEl) {
      instances.limitCount = new DevExpress.ui.dxNumberBox(limitCountEl, {
        value: limitState.count,
        min: 0,
        format: '#',
        showSpinButtons: true,
        placeholder: 'Count',
        onValueChanged: function(e) { limitState.count = e.value || 0; recomputeAndRender(); }
      });
    }
    var limitOffsetEl = getEl('limitOffset');
    if (limitOffsetEl) {
      instances.limitOffset = new DevExpress.ui.dxNumberBox(limitOffsetEl, {
        value: limitState.offset,
        min: 0,
        format: '#',
        showSpinButtons: true,
        placeholder: 'Offset',
        onValueChanged: function(e) { limitState.offset = e.value || 0; recomputeAndRender(); }
      });
    }
  }

  function initFilterPopup() {
    var filterBtnEl = getEl('filterBtn');
    if (filterBtnEl) {
      instances.filterBtn = new DevExpress.ui.dxButton(filterBtnEl, {
        text: 'Filter',
        onClick: function () {
          var fb = ensureFilterBuilderInitialized();
          if (fb) fb.option('fields', buildFilterFields());
          if (instances.filterPopup) instances.filterPopup.show();
        },
      });
    }

    var popupEl = getEl('filterPopup');
    if (popupEl) {
      instances.filterPopup = new DevExpress.ui.dxPopup(popupEl, {
        title: 'Filter Builder',
        visible: false,
        width: 700,
        height: 520,
        showCloseButton: true,
        onShowing: function () {
          var fb = ensureFilterBuilderInitialized();
          if (fb) {
            fb.option('fields', buildFilterFields());
            attachFilterBuilderHandlers();
          }
        },
      });
    }

    var fbEl = getEl('filterBuilder');
    if (fbEl) {
      instances.filterBuilder = new DevExpress.ui.dxFilterBuilder(fbEl, {
        fields: buildFilterFields(),
        groupOperations: ['and', 'or', 'notAnd', 'notOr'],
      });
      attachFilterBuilderHandlers();
    }

    var applyBtnEl = getEl('filterApplyBtn');
    if (applyBtnEl) {
      instances.filterApplyBtn = new DevExpress.ui.dxButton(applyBtnEl, {
        text: 'Apply',
        type: 'default',
        onClick: function () {
          var fb = instances.filterBuilder;
          filterExpr = fb ? (fb.option('value') || null) : null;
          var sumEl = getEl('filterSummary');
          if (sumEl) sumEl.textContent = filterExpr ? JSON.stringify(filterExpr) : '';
          if (instances.filterPopup) instances.filterPopup.hide();
          recomputeAndRender();
        },
      });
    }

    var clearBtnEl = getEl('filterClearBtn');
    if (clearBtnEl) {
      instances.filterClearBtn = new DevExpress.ui.dxButton(clearBtnEl, {
        text: 'Clear',
        onClick: function () {
          filterExpr = null;
          var sumEl = getEl('filterSummary');
          if (sumEl) sumEl.textContent = '';
          if (instances.filterBuilder) instances.filterBuilder.option('value', null);
          recomputeAndRender();
        },
      });
    }
  }

  function initAliasPopup() {
    var popupEl = getEl('aliasPopup');
    if (popupEl) {
      instances.aliasPopup = new DevExpress.ui.dxPopup(popupEl, {
        title: 'Edit Column Alias',
        visible: false,
        width: 420,
        height: 200,
        showCloseButton: true,
        onShown: function () {
          // Initialize inner widgets if missing, else update value and focus
          var edEl = getEl('aliasEditor');
          if (edEl && !instances.aliasEditor) {
            instances.aliasEditor = new DevExpress.ui.dxTextBox(edEl, {
              value: aliasEditState.alias,
              stylingMode: 'filled',
              placeholder: 'Alias (e.g., customer_name)',
              width: '100%',
              onEnterKey: function() { aliasSave(); },
              onKeyDown: function(e) { if (e.event && e.event.key === 'Enter') { e.event.preventDefault(); } }
            });
          } else if (instances.aliasEditor) {
            instances.aliasEditor.option('value', aliasEditState.alias);
          }
          var saveEl = getEl('aliasSaveBtn');
          if (saveEl && !instances.aliasSaveBtn) {
            instances.aliasSaveBtn = new DevExpress.ui.dxButton(saveEl, { text: 'Save', type: 'default', onClick: function(){ aliasSave(); } });
          }
          var cancelEl = getEl('aliasCancelBtn');
          if (cancelEl && !instances.aliasCancelBtn) {
            instances.aliasCancelBtn = new DevExpress.ui.dxButton(cancelEl, { text: 'Cancel', onClick: function(){ instances.aliasPopup && instances.aliasPopup.hide(); } });
          }
          setTimeout(function(){ instances.aliasEditor && instances.aliasEditor.focus(); }, 0);
        }
      });
    }
    // Do not pre-instantiate inner widgets here; handled in onShown
  }

  function aliasSave() {
    if (!aliasEditState.table || !aliasEditState.column) { if (instances.aliasPopup) instances.aliasPopup.hide(); return; }
    var val = instances.aliasEditor ? (instances.aliasEditor.option('value') || '').trim() : '';
    var list = selectedColumnsByTable[aliasEditState.table] || [];
    selectedColumnsByTable[aliasEditState.table] = list.filter(function (x) {
      var base = aliasEditState.column.toLowerCase();
      var low = x.toLowerCase();
      return !(low === base || low.startsWith(base + ' as ') || low.startsWith(base + ':'));
    });
    var toAdd = aliasEditState.column + (val ? (' AS ' + val) : '');
    selectedColumnsByTable[aliasEditState.table].push(toAdd);
    if (instances.aliasPopup) instances.aliasPopup.hide();
    renderKanban();
    recomputeAndRender();
  }

  function buildFilterFields() {
    // Build fields across selected tables
    var fields = [];
    var tables = (selectedTables && selectedTables.length > 0)
      ? selectedTables
      : window.MockSchema.tables.map(function (t) { return t.name; });
    tables.forEach(function (t) {
      var table = window.getTable(t);
      table.columns.forEach(function (c) {
        fields.push({
          dataField: fieldKey(t + '.' + c.name),
          dataType: mapType(c.type),
          caption: t + ' • ' + c.name,
        });
      });
    });
    return fields;
  }

  function ensureFilterBuilderInitialized() {
    if (!instances.filterBuilder) {
      var el = getEl('filterBuilder');
      if (!el) return null;
      instances.filterBuilder = new DevExpress.ui.dxFilterBuilder(el, {
        fields: buildFilterFields(),
        groupOperations: ['and', 'or', 'notAnd', 'notOr'],
      });
      attachFilterBuilderHandlers();
    }
    return instances.filterBuilder;
  }

  function refreshFilterBuilderFields() {
    if (instances.filterBuilder) {
      instances.filterBuilder.option('fields', buildFilterFields());
    }
  }

  function attachFilterBuilderHandlers() {
    if (!instances.filterBuilder) return;
    instances.filterBuilder.option({
      onContentReady: function (e) {
        console.log('filterBuilder onContentReady');
        if (filterExpr) e.component.option('value', filterExpr);
      },
      onValueChanged: function(e) {
        console.log('filterBuilder onValueChanged', e.value);
        filterExpr = e.value || null;
        var sumEl = getEl('filterSummary');
        if (sumEl) sumEl.textContent = filterExpr ? JSON.stringify(filterExpr) : '';
        recomputeAndRender();
      },
    });
  }

  function mapType(t) {
    if (t === 'number') return 'number';
    if (t === 'date') return 'date';
    return 'string';
  }

  function initJoinPopup() {
    var joinPopupEl = getEl('joinPopup');
    if (!joinPopupEl) return;

    instances.joinPopup = new DevExpress.ui.dxPopup(joinPopupEl, {
      title: 'Join Configuration',
      visible: false,
      width: 720,
      height: 500,
      showCloseButton: true,
      onShowing: function () {
        var ds = new DevExpress.data.ArrayStore({
          key: 'id',
          data: joins.map(function (j, idx) { return $.extend({ id: idx + 1 }, j); }),
        });
        var gridEl = getEl('joinsGrid');
        if (!gridEl) return;
        instances.joinGrid = new DevExpress.ui.dxDataGrid(gridEl, {
          dataSource: ds,
          editing: {
            mode: 'row',
            allowAdding: true,
            allowUpdating: true,
            allowDeleting: true,
          },
          columns: [
            { dataField: 'type', caption: 'Type', lookup: { dataSource: ['inner', 'left', 'right'] } },
            { dataField: 'leftTable', caption: 'Left Table', lookup: { dataSource: selectedTables } },
            { dataField: 'leftColumn', caption: 'Left Column', calculateDisplayValue: function (row) { return row.leftColumn; } },
            { dataField: 'rightTable', caption: 'Right Table', lookup: { dataSource: selectedTables } },
            { dataField: 'rightColumn', caption: 'Right Column', calculateDisplayValue: function (row) { return row.rightColumn; } },
          ],
          onEditorPreparing: function(e) {
            if (e.parentType !== 'dataRow') return;
            if (e.dataField === 'leftColumn') {
              e.editorName = 'dxSelectBox';
              var lt = e.row && e.row.data && e.row.data.leftTable;
              e.editorOptions = e.editorOptions || {};
              e.editorOptions.dataSource = getColumnsOfTable(lt);
            }
            if (e.dataField === 'rightColumn') {
              e.editorName = 'dxSelectBox';
              var rt = e.row && e.row.data && e.row.data.rightTable;
              e.editorOptions = e.editorOptions || {};
              e.editorOptions.dataSource = getColumnsOfTable(rt);
            }
          },
          onCellValueChanged: function(e) {
            if (e.column && e.column.dataField === 'leftTable') {
              e.component.cellValue(e.rowIndex, 'leftColumn', null);
            }
            if (e.column && e.column.dataField === 'rightTable') {
              e.component.cellValue(e.rowIndex, 'rightColumn', null);
            }
          },
          onRowInserted: function() { updateJoinsFromGrid(); },
          onRowUpdated: function() { updateJoinsFromGrid(); },
          onRowRemoved: function() { updateJoinsFromGrid(); },
          onSaved: function() { updateJoinsFromGrid(); },
          onEditingStop: function() { updateJoinsFromGrid(); },
          onSelectionChanged: function() { /* no-op */ },
        });
      },
    });

    var saveBtnEl = getEl('joinSaveBtn');
    if (saveBtnEl) {
      instances.joinSaveBtn = new DevExpress.ui.dxButton(saveBtnEl, {
        text: 'Save',
        type: 'default',
        onClick: function () {
          var grid = instances.joinGrid;
          if (!grid) return;
          grid.saveEditData();
          var data = grid.getDataSource().items();
          joins = data.map(function (d) { return { type: d.type, leftTable: d.leftTable, leftColumn: d.leftColumn, rightTable: d.rightTable, rightColumn: d.rightColumn }; });
          if (instances.joinPopup) instances.joinPopup.hide();
          recomputeAndRender();
        },
      });
    }

    var cancelBtnEl = getEl('joinCancelBtn');
    if (cancelBtnEl) {
      instances.joinCancelBtn = new DevExpress.ui.dxButton(cancelBtnEl, { text: 'Cancel', onClick: function () { if (instances.joinPopup) instances.joinPopup.hide(); } });
    }
  }

  function showJoinPopup() {
    if (instances.joinPopup) instances.joinPopup.show();
  }

  function showAliasPopup(table, column) {
    aliasEditState.table = table;
    aliasEditState.column = column;
    // prefill alias if existing
    var list = selectedColumnsByTable[table] || [];
    var found = list.find(function (x) {
      var low = x.toLowerCase();
      var base = column.toLowerCase();
      return low.startsWith(base + ' as ') || low.startsWith(base + ':');
    });
    aliasEditState.alias = '';
    if (found) {
      var asIdx = found.toLowerCase().indexOf(' as ');
      var colonIdx = found.indexOf(':');
      if (asIdx !== -1) aliasEditState.alias = found.substring(asIdx + 4).trim();
      else if (colonIdx !== -1) aliasEditState.alias = found.substring(colonIdx + 1).trim();
    }
    // proactively set editor value if already instantiated
    if (instances.aliasEditor) {
      instances.aliasEditor.option('value', aliasEditState.alias);
    }
    if (instances.aliasPopup) instances.aliasPopup.show();
  }

  function updateJoinsFromGrid() {
    if (!instances.joinGrid) return;
    var items = instances.joinGrid.getDataSource().items();
    joins = items.map(function (d) {
      return {
        type: d.type || 'inner',
        leftTable: d.leftTable,
        leftColumn: d.leftColumn,
        rightTable: d.rightTable,
        rightColumn: d.rightColumn,
      };
    });
    recomputeAndRender();
  }

  function renderKanban() {
    var $c = $('#kanbanContainer');
    $c.empty();
    selectedTables.forEach(function (t) {
      var table = window.getTable(t);
      var $list = $('<div class="kanban-list"></div>');
      var $header = $('<div class="kanban-header"></div>').text(t);
      var $cols = $('<div class="kanban-columns" id="kanban-cols-' + t + '"></div>');

      table.columns.forEach(function (col) {
        var key = t + '.' + col.name;
        var $item = $('<div class="kanban-col" draggable="true" data-key="' + key + '" data-table="' + t + '" data-column="' + col.name + '"></div>');
        // show current alias in label
        var display = col.name;
        var list = selectedColumnsByTable[t] || [];
        var selAliased = list.find(function (x) {
          var base = col.name.toLowerCase();
          var low = x.toLowerCase();
          return low.startsWith(base + ' as ') || low.startsWith(base + ':');
        });
        if (selAliased) {
          var a = selAliased.toLowerCase().indexOf(' as ') !== -1 ? selAliased.split(/\s+as\s+/i)[1] : selAliased.split(':')[1];
          if (a) display = col.name + ' → ' + a.trim();
        }
        $item.text(display);
        if ((list.map(function(x){return x.split(/\s+as\s+/i)[0].split(':')[0];}).indexOf(col.name) !== -1)) { $item.addClass('selected'); }
        $cols.append($item);
      });

      $list.append($header).append($cols);
      $c.append($list);
    });

    // Enable drag and drop to group/order zones
    enableDnD();
  }

  function enableDnD() {
    // Drag start
    $(document).off('dragstart.kanban').on('dragstart.kanban', '.kanban-col', function (e) {
      e.originalEvent.dataTransfer.setData('text/plain', $(this).data('key'));
    });

    // Drag over zones
    ['#groupByZone', '#orderByZone'].forEach(function (zone) {
      $(zone).off('dragover.kanban drop.kanban');
      $(zone).on('dragover.kanban', function (e) { e.preventDefault(); });
      $(zone).on('drop.kanban', function (e) {
        e.preventDefault();
        var key = e.originalEvent.dataTransfer.getData('text/plain');
        var parts = key.split('.');
        var entry = { table: parts[0], column: parts[1] };
        if (zone === '#groupByZone') {
          if (!groupBy.some(function (g) { return g.table === entry.table && g.column === entry.column; })) {
            groupBy.push(entry);
            renderChips('#groupByZone', groupBy, function (r) { groupBy = r; recomputeAndRender(); });
            recomputeAndRender();
          }
        } else {
          if (!orderBy.some(function (g) { return g.table === entry.table && g.column === entry.column; })) {
            orderBy.push($.extend({ desc: false }, entry));
            renderChips('#orderByZone', orderBy, function (r) { orderBy = r; recomputeAndRender(); }, true);
            recomputeAndRender();
          }
        }
      });
    });

    // Aggregations zone
    var aggZone = '#aggZone';
    $(aggZone).off('dragover.kanban drop.kanban');
    $(aggZone).on('dragover.kanban', function (e) { e.preventDefault(); });
    $(aggZone).on('drop.kanban', function (e) {
      e.preventDefault();
      var key = e.originalEvent.dataTransfer.getData('text/plain');
      var parts = key.split('.');
      var entry = { table: parts[0], column: parts[1], func: 'count', alias: parts[0] + '_' + parts[1] + '_count' };
      if (!aggregates.some(function (a) { return a.table === entry.table && a.column === entry.column; })) {
        aggregates.push(entry);
        renderAggChips();
        recomputeAndRender();
      }
    });

    // Click vs Double-click behavior
    var clickTimer = null;
    var clickDelayMs = 250;

    $(document).off('click.selectCol').on('click.selectCol', '.kanban-col', function (ev) {
      var el = this;
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(function () {
        var table = $(el).data('table');
        var column = $(el).data('column');
        selectedColumnsByTable[table] = selectedColumnsByTable[table] || [];
        var list = selectedColumnsByTable[table];
        // consider both plain and aliased entries when toggling
        var idx = list.findIndex(function (x) {
          var base = column.toLowerCase();
          var low = x.toLowerCase();
          return low === base || low.startsWith(base + ' as ') || low.startsWith(base + ':');
        });
        if (idx === -1) {
          list.push(column);
          $(el).addClass('selected');
        } else {
          list.splice(idx, 1);
          $(el).removeClass('selected');
        }
        renderKanban();
        recomputeAndRender();
      }, clickDelayMs);
    });

    $(document).off('dblclick.editAlias').on('dblclick.editAlias', '.kanban-col', function (ev) {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      ev.preventDefault();
      ev.stopPropagation();
      var table = $(this).data('table');
      var column = $(this).data('column');
      showAliasPopup(table, column);
    });
  }

  function renderChips(zoneSelector, items, onChange, hasSortToggle) {
    var $z = $(zoneSelector);
    $z.empty();
    items.forEach(function (it, idx) {
      var label = it.table + '.' + it.column;
      var $chip = $('<span class="chip"></span>');
      $chip.append($('<span></span>').text(label));
      if (hasSortToggle) {
        var $toggle = $('<a href="#" class="toggle-sort"></a>').text(it.desc ? ' DESC' : ' ASC');
        $toggle.on('click', function (e) { e.preventDefault(); it.desc = !it.desc; $(this).text(it.desc ? ' DESC' : ' ASC'); recomputeAndRender(); });
        $chip.append($toggle);
      }
      var $rm = $('<a href="#" class="remove">✕</a>');
      $rm.on('click', function (e) {
        e.preventDefault();
        var copy = items.slice();
        copy.splice(idx, 1);
        onChange(copy);
        renderChips(zoneSelector, copy, onChange, hasSortToggle);
      });
      $chip.append($rm);
      $z.append($chip);
    });
  }

  function renderAggChips() {
    var $z = $('#aggZone');
    $z.empty();
    aggregates.forEach(function (a, idx) {
      var $chip = $('<span class="chip"></span>');
      var $sel = $('<select></select>');
      ['count', 'sum', 'avg', 'min', 'max'].forEach(function (fn) {
        var $o = $('<option></option>').attr('value', fn).text(fn.toUpperCase());
        if (a.func === fn) $o.attr('selected', 'selected');
        $sel.append($o);
      });
      $sel.on('change', function () { a.func = this.value; if (!a.alias || /_(count|sum|avg|min|max)$/.test(a.alias)) { a.alias = a.table + '_' + a.column + '_' + a.func; } recomputeAndRender(); });
      var $label = $('<span></span>').text(' ' + a.table + '.' + a.column + ' AS ');
      var $alias = $('<input type="text"/>').val(a.alias || (a.table + '_' + a.column + '_' + a.func)).on('input', function () { a.alias = this.value; recomputeAndRender(); });
      var $rm = $('<a href="#" class="remove">✕</a>').on('click', function (e) { e.preventDefault(); aggregates.splice(idx, 1); renderAggChips(); recomputeAndRender(); });
      $chip.append($sel).append($label).append($alias).append($rm);
      $z.append($chip);
    });
  }

  function initPreviewGrid() {
    var gridEl = getEl('previewGrid');
    if (!gridEl) return;

    instances.previewGrid = new DevExpress.ui.dxDataGrid(gridEl, {
      dataSource: [],
      columnAutoWidth: true,
      showBorders: true,
      height: '100%',
      paging: { pageSize: 10 },
      pager: { showPageSizeSelector: true, allowedPageSizes: [10, 20, 50], showInfo: true },
      sorting: { mode: 'none' },
    });
  }

  function recomputeAndRender() {
    // Update filter fields in FilterBuilder according to selected tables
    var fb = instances.filterBuilder;
    if (fb) fb.option('fields', buildFilterFields());

    // Compute query result over mock data
    var result = runQuery();

    var grid = instances.previewGrid;
    if (grid) {
      grid.option('dataSource', result.rows);
      grid.option('columns', result.columns);
    }

    // Update SQL preview
    var sql = buildSqlPreview();
    var sqlEl = getEl('sqlPreview');
    if (sqlEl) sqlEl.textContent = sql;
  }

  function runQuery() {
    // 1) Materialize FROM + JOIN
    var data = materializeFromAndJoins();

    // 1.1) Normalize keys for grid/filter (dots -> double underscores)
    var normalized = data.map(sanitizeRowKeys);

    // 2) WHERE filter
    if (filterExpr) {
      var predicate = compileFilterPredicate(filterExpr);
      if (predicate) normalized = normalized.filter(predicate);
    }

    // 3) SELECT columns
    var selectColumns = buildSelectColumnDefs();
    var projected = normalized.map(function (row) {
      var out = {};
      selectColumns.forEach(function (c) {
        out[c.dataField] = row[c.dataField];
      });
      return out;
    });

    // 4) GROUP BY
    if (groupBy.length > 0) {
      var groupKeys = groupBy.map(function (g) { return fieldKey(g.table + '.' + g.column); });
      var groupedMap = {};
      projected.forEach(function (row) {
        var key = groupKeys.map(function (k) { return String(row[k]); }).join('|');
        if (!groupedMap[key]) {
          groupedMap[key] = { __rows: [], __base: {} };
          groupKeys.forEach(function (k) { groupedMap[key].__base[k] = row[k]; });
        }
        groupedMap[key].__rows.push(row);
      });

      // compute aggregates
      var resultRows = [];
      Object.keys(groupedMap).forEach(function (k) {
        var bucket = groupedMap[k];
        var out = $.extend({}, bucket.__base);
        aggregates.forEach(function (a) {
          var fkey = fieldKey(a.table + '.' + a.column);
          var aliasKey = fieldKey(a.alias || (a.table + '_' + a.column + '_' + a.func));
          var values = bucket.__rows.map(function (r) { return r[fkey]; }).filter(function (v) { return typeof v !== 'undefined' && v !== null; });
          var val = null;
          switch (a.func) {
            case 'count': val = values.length; break;
            case 'sum': val = values.reduce(function (acc, x) { var n = parseFloat(x); return acc + (isNaN(n) ? 0 : n); }, 0); break;
            case 'avg': var s = values.reduce(function (acc, x) { var n = parseFloat(x); return acc + (isNaN(n) ? 0 : n); }, 0); val = values.length ? (s / values.length) : null; break;
            case 'min': val = values.reduce(function (m, x) { var n = parseFloat(x); if (isNaN(n)) return m; return m == null ? n : Math.min(m, n); }, null); break;
            case 'max': val = values.reduce(function (m, x) { var n = parseFloat(x); if (isNaN(n)) return m; return m == null ? n : Math.max(m, n); }, null); break;
            default: val = null;
          }
          out[aliasKey] = val;
        });
        resultRows.push(out);
      });
      projected = resultRows;
    }

    // 5) ORDER BY
    if (orderBy.length > 0) {
      projected.sort(function (a, b) {
        for (var i = 0; i < orderBy.length; i++) {
          var o = orderBy[i];
          var key = fieldKey(o.table + '.' + o.column);
          var av = a[key];
          var bv = b[key];
          if (av < bv) return o.desc ? 1 : -1;
          if (av > bv) return o.desc ? -1 : 1;
        }
        return 0;
      });
    }

    // 6) LIMIT/OFFSET
    var start = Math.max(0, parseInt(limitState.offset || 0, 10));
    var count = Math.max(0, parseInt(limitState.count || 0, 10));
    var sliced = count > 0 ? projected.slice(start, start + count) : projected.slice(start);

    return { rows: sliced, columns: selectColumns.map(function (c) { return { dataField: c.dataField, caption: c.captionAlias || c.caption }; }) };
  }

  function buildSelectColumnDefs() {
    var cols = [];
    selectedTables.forEach(function (t) {
      // use only explicitly selected columns; no fallback to all columns
      var sel = selectedColumnsByTable[t] || [];
      sel.forEach(function (c) {
        var original = t + '.' + c;
        // Support alias via syntax columnName AS alias or columnName:alias
        var colName = c;
        var alias = null;
        var asIdx = c.toLowerCase().indexOf(' as ');
        var colonIdx = c.indexOf(':');
        if (asIdx !== -1) { alias = c.substring(asIdx + 4).trim(); colName = c.substring(0, asIdx).trim(); }
        else if (colonIdx !== -1) { alias = c.substring(colonIdx + 1).trim(); colName = c.substring(0, colonIdx).trim(); }
        var qualified = t + '.' + colName;
        cols.push({ dataField: fieldKey(qualified), caption: qualified, captionAlias: alias });
      });
    });
    // include aggregate outputs as columns when grouping
    if (groupBy.length > 0 && aggregates.length > 0) {
      aggregates.forEach(function (a) {
        var aliasKey = fieldKey(a.alias || (a.table + '_' + a.column + '_' + a.func));
        cols.push({ dataField: aliasKey, caption: (a.func.toUpperCase() + '(' + a.table + '.' + a.column + ')'), captionAlias: a.alias });
      });
    }
    return cols;
  }

  function materializeFromAndJoins() {
    if (selectedTables.length === 0) return [];
    var baseName = selectedTables[0];
    var baseRows = window.getTable(baseName).rows.map(function (r) { return wrapRow(baseName, r); });

    // Apply joins sequentially with the previous table
    var rows = baseRows;
    var currentBase = baseName;
    selectedTables.slice(1).forEach(function (t) {
      var tRows = window.getTable(t).rows.map(function (r) { return wrapRow(t, r); });
      var relevantJoins = joins.filter(function (j) {
        return (j.leftTable === currentBase && j.rightTable === t) || (j.leftTable === t && j.rightTable === currentBase);
      });
      // If no explicit join specified between currentBase and t, infer
      var activeJoin = relevantJoins[0] || inferJoin(currentBase, t);
      rows = joinRows(rows, tRows, activeJoin);
      currentBase = t;
    });
    return rows;
  }

  function inferJoin(a, b) {
    // Simple heuristic: if b has a field a+'_id' join on that vs a.id
    var aHasId = hasColumn(a, 'id');
    var bHasAid = hasColumn(b, a.slice(0, -1) + '_id') || hasColumn(b, a + '_id');
    if (aHasId && bHasAid) {
      var aid = hasColumn(b, a.slice(0, -1) + '_id') ? a.slice(0, -1) + '_id' : a + '_id';
      return { type: 'inner', leftTable: a, leftColumn: 'id', rightTable: b, rightColumn: aid };
    }
    // reverse
    var bHasId = hasColumn(b, 'id');
    var aHasBid = hasColumn(a, b.slice(0, -1) + '_id') || hasColumn(a, b + '_id');
    if (bHasId && aHasBid) {
      var bid = hasColumn(a, b.slice(0, -1) + '_id') ? b.slice(0, -1) + '_id' : b + '_id';
      return { type: 'inner', leftTable: a, leftColumn: bid, rightTable: b, rightColumn: 'id' };
    }
    // fallback cartesian (inner)
    return { type: 'inner', leftTable: a, leftColumn: null, rightTable: b, rightColumn: null };
  }

  function hasColumn(tableName, col) {
    var t = window.getTable(tableName);
    return !!t.columns.find(function (c) { return c.name === col; });
  }

  function getColumnsOfTable(tableName) {
    if (!tableName) return [];
    var t = window.getTable(tableName);
    return t ? t.columns.map(function (c) { return c.name; }) : [];
  }

  function joinRows(leftRows, rightRows, joinDef) {
    var type = (joinDef && joinDef.type) || 'inner';
    var lT = joinDef.leftTable, lC = joinDef.leftColumn, rT = joinDef.rightTable, rC = joinDef.rightColumn;
    var out = [];
    if (!lC || !rC) {
      // cartesian
      leftRows.forEach(function (L) {
        rightRows.forEach(function (R) { out.push($.extend({}, L, R)); });
      });
      return out;
    }
    leftRows.forEach(function (L) {
      var matches = rightRows.filter(function (R) {
        return getValue(L, lT + '.' + lC) === getValue(R, rT + '.' + rC);
      });
      if (matches.length > 0) {
        matches.forEach(function (R) { out.push($.extend({}, L, R)); });
      } else if (type === 'left') {
        // left join: keep left row
        out.push($.extend({}, L));
      }
    });
    if (type === 'right') {
      // include right rows with no match
      rightRows.forEach(function (R) {
        var found = leftRows.some(function (L) { return getValue(L, lT + '.' + lC) === getValue(R, rT + '.' + rC); });
        if (!found) out.push($.extend({}, R));
      });
    }
    return out;
  }

  function wrapRow(tableName, row) {
    var wrapped = {};
    Object.keys(row).forEach(function (k) { wrapped[tableName + '.' + k] = row[k]; });
    return wrapped;
  }

  function getValue(row, dataField) {
    return row[dataField];
  }

  function groupArray(rows, keys) {
    var map = {};
    rows.forEach(function (r) {
      var key = keys.map(function (k) { return String(r[k]); }).join('|');
      if (!map[key]) {
        // initialize group row with group keys only
        var base = {};
        keys.forEach(function (k) { base[k] = r[k]; });
        map[key] = base;
      }
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function translateFilterExpr(expr) {
    // DevExtreme filter is compatible with DataSource, pass through
    return expr;
  }

  function compileFilterPredicate(expr) {
    if (!expr) return null;

    function isGroup(e) {
      if (!Array.isArray(e)) return false;
      if (e.length === 3 && typeof e[0] === 'string') return false; // simple
      return true;
    }

    function compile(e) {
      if (!Array.isArray(e)) return null;
      // negate form: ['!', subexpr]
      if (e.length === 2 && e[0] === '!') {
        var sub = compile(e[1]);
        return function (row) { return !sub(row); };
      }
      // simple predicate
      if (e.length === 3 && typeof e[0] === 'string') {
        var field = e[0];
        var op = e[1];
        var val = e[2];
        return function (row) { return matchSimple(row, field, op, val); };
      }
      // group: [expr, 'and'/'or', expr, ...] optionally with 'notAnd'/'notOr'
      var parts = [];
      var ops = [];
      var negateGroup = false;
      for (var i = 0; i < e.length; i++) {
        var token = e[i];
        if (Array.isArray(token)) {
          parts.push(compile(token));
        } else if (typeof token === 'string') {
          var low = token.toLowerCase();
          if (low === 'and' || low === 'or') ops.push(low);
          if (low === 'notand') { ops.push('and'); negateGroup = true; }
          if (low === 'notor') { ops.push('or'); negateGroup = true; }
        }
      }
      return function (row) {
        if (parts.length === 0) return true;
        var acc = parts[0](row);
        for (var j = 1, k = 0; j < parts.length; j++, k++) {
          var opj = ops[k] || 'and';
          if (opj === 'and') acc = acc && parts[j](row);
          else acc = acc || parts[j](row);
        }
        return negateGroup ? !acc : acc;
      };
    }

    function matchSimple(row, field, op, val) {
      var v = row[field];
      if (typeof v === 'undefined') {
        // try the alternate key form (sanitized vs unsanitized)
        var alt = field.indexOf('__') !== -1 ? field.replace(/__/g, '.') : field.replace(/\./g, '__');
        v = row[alt];
      }
      // handle null checks first
      if (op === 'isblank') return v == null || v === '';
      if (op === 'isnotblank') return !(v == null || v === '');
      // between: [from, to]
      if (op === 'between' && Array.isArray(val) && val.length === 2) {
        var a = normalizeComparable(v);
        var from = normalizeComparable(val[0]);
        var to = normalizeComparable(val[1]);
        if (a == null || from == null || to == null) return false;
        return a >= from && a <= to;
      }
      // anyof / noneof
      if ((op === 'anyof' || op === 'noneof') && Array.isArray(val)) {
        var aNorm = normalizeComparable(v);
        var set = val.map(normalizeComparable);
        var contains = set.some(function (x) { return equalsComparable(aNorm, x); });
        return op === 'anyof' ? contains : !contains;
      }
      // Normalize numbers/dates/strings
      var isNum = typeof v === 'number' || typeof val === 'number';
      if (isNum) {
        var nv = typeof v === 'number' ? v : parseFloat(v);
        var nval = typeof val === 'number' ? val : parseFloat(val);
        if (Number.isNaN(nv) || Number.isNaN(nval)) { v = String(v); val = String(val); return compareStrings(v, op, val); }
        return compareNumbers(nv, op, nval);
      }
      // dates: allow ISO strings and Date objects
      if ((v && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) || v instanceof Date) {
        var dv = v instanceof Date ? v.getTime() : new Date(v).getTime();
        var dval = val instanceof Date ? val.getTime() : new Date(val).getTime();
        if (!isNaN(dv) && !isNaN(dval)) return compareNumbers(dv, op, dval);
      }
      return compareStrings(v == null ? '' : String(v), op, val == null ? '' : String(val));
    }

    function normalizeComparable(x) {
      if (x == null) return null;
      if (x instanceof Date) return x.getTime();
      if (typeof x === 'number') return x;
      if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x)) {
        var d = new Date(x).getTime();
        return isNaN(d) ? x.toLowerCase() : d;
      }
      if (typeof x === 'string') return x.toLowerCase();
      return x;
    }

    function equalsComparable(a, b) {
      return a === b;
    }

    function compareNumbers(a, op, b) {
      switch (op) {
        case '=': return a === b;
        case '<>': return a !== b;
        case '>': return a > b;
        case '>=': return a >= b;
        case '<': return a < b;
        case '<=': return a <= b;
        default: return false;
      }
    }

    function compareStrings(a, op, b) {
      var A = a.toLowerCase();
      var B = b.toLowerCase();
      switch (op) {
        case '=': return A === B;
        case '<>': return A !== B;
        case 'contains': return A.indexOf(B) !== -1;
        case 'notcontains': return A.indexOf(B) === -1;
        case 'startswith': return A.indexOf(B) === 0;
        case 'endswith': return A.lastIndexOf(B) === (A.length - B.length);
        case '>': return A > B;
        case '>=': return A >= B;
        case '<': return A < B;
        case '<=': return A <= B;
        default: return false;
      }
    }

    return compile(expr);
  }

  function buildSqlPreview() {
    if (selectedTables.length === 0) return '-- Select at least one table';

    function parseAliasToken(token) {
      var colName = token;
      var alias = null;
      if (!token) return { colName: token, alias: null };
      var asIdx = token.toLowerCase().indexOf(' as ');
      var colonIdx = token.indexOf(':');
      if (asIdx !== -1) { alias = token.substring(asIdx + 4).trim(); colName = token.substring(0, asIdx).trim(); }
      else if (colonIdx !== -1) { alias = token.substring(colonIdx + 1).trim(); colName = token.substring(0, colonIdx).trim(); }
      return { colName: colName, alias: alias };
    }

    function sqlJsonValue(alias, path) {
      return "JSON_VALUE(" + alias + ".Content, '$." + path + "')";
    }

    function sqlExprForField(field) {
      var parts = String(field).split('.');
      var alias = parts.shift();
      var path = parts.join('.');
      return sqlJsonValue(alias, path);
    }

    var parts = [];

    // SELECT
    var selectCols = [];
    selectedTables.forEach(function (t) {
      var sel = (selectedColumnsByTable[t] && selectedColumnsByTable[t].length > 0)
        ? selectedColumnsByTable[t]
        : [];
      sel.forEach(function (token) {
        var p = parseAliasToken(token);
        var expr = sqlJsonValue(t, p.colName);
        selectCols.push(p.alias ? (expr + ' AS ' + p.alias) : (expr + ' AS ' + (t + '_' + p.colName.replace(/\./g, '_'))));
      });
    });
    // Aggregates (if any)
    if (groupBy.length > 0 && typeof aggregates !== 'undefined' && aggregates.length > 0) {
      aggregates.forEach(function (a) {
        var expr = a.func.toUpperCase() + '(' + sqlJsonValue(a.table, a.column) + ')';
        selectCols.push(a.alias ? (expr + ' AS ' + a.alias) : expr);
      });
    }
    if (selectCols.length === 0) {
      return '-- Select at least one column';
    }
    parts.push('SELECT ' + selectCols.join(', '));

    // FROM + self-JOINS on DefaultStagingData, aliasing by table name
    parts.push('FROM DefaultStagingData ' + selectedTables[0]);
    var currentBase = selectedTables[0];
    selectedTables.slice(1).forEach(function (t) {
      var j = (joins && joins.find) ? (joins.find(function (x) {
        return (x.leftTable === currentBase && x.rightTable === t) || (x.leftTable === t && x.rightTable === currentBase);
      }) || null) : null;
      if (!j) { j = inferJoin(currentBase, t); }
      var type = (j.type || 'inner').toUpperCase();
      var leftAlias = j.leftTable;
      var rightAlias = j.rightTable;
      var leftPath = j.leftColumn || 'id';
      var rightPath = j.rightColumn || 'id';
      parts.push(type + ' JOIN DefaultStagingData ' + (leftAlias === currentBase ? rightAlias : leftAlias) + ' ON '
        + sqlJsonValue(leftAlias, leftPath) + ' = ' + sqlJsonValue(rightAlias, rightPath));
      currentBase = t;
    });

    // WHERE (batch filters per alias) + filter expression
    var whereParts = [];
    // Per-alias latest batch filter
    selectedTables.forEach(function (t) {
      whereParts.push(t + ".DefaultStagingDataBatchId = (select top 1 Id from DefaultStagingDataBatch where DrawflowIdentifier = '" + t + "' order by CreatedAt desc)");
    });
    if (filterExpr) {
      var wf = stringifyFilterForJson(filterExpr);
      if (wf) whereParts.push(wf);
    }
    if (whereParts.length > 0) {
      parts.push('WHERE ' + whereParts.join(' AND '));
    }

    // GROUP BY
    if (groupBy.length > 0) {
      var g = groupBy.map(function (x) { return sqlJsonValue(x.table, x.column); });
      parts.push('GROUP BY ' + g.join(', '));
    }

    // ORDER BY
    if (orderBy.length > 0) {
      var o = orderBy.map(function (x) { return sqlJsonValue(x.table, x.column) + (x.desc ? ' DESC' : ' ASC'); });
      parts.push('ORDER BY ' + o.join(', '));
    }

    // LIMIT/OFFSET
    if (typeof limitState !== 'undefined' && limitState.count && limitState.count > 0) {
      parts.push('LIMIT ' + Math.max(0, parseInt(limitState.count, 10)));
    }
    if (typeof limitState !== 'undefined' && limitState.offset && limitState.offset > 0) {
      parts.push('OFFSET ' + Math.max(0, parseInt(limitState.offset, 10)));
    }

    return parts.join('\n');
  }

  function stringifyFilter(expr) {
    // Minimal translation of DevExtreme filter array to SQL-like string
    if (!expr) return '';
    if (Array.isArray(expr)) {
      // compound
      if (expr.length === 3 && typeof expr[0] === 'string') {
        return simplePredicateToSql(expr);
      }
      // group: [cond1, 'and'/'or', cond2, ...]
      var out = [];
      for (var i = 0; i < expr.length; i++) {
        var token = expr[i];
        if (Array.isArray(token)) {
          out.push('(' + stringifyFilter(token) + ')');
        } else if (typeof token === 'string' && (token.toLowerCase() === 'and' || token.toLowerCase() === 'or')) {
          out.push(token.toUpperCase());
        }
      }
      return out.join(' ');
    }
    return '';
  }

  function simplePredicateToSql(p) {
    var field = p[0];
    var op = p[1];
    var val = p[2];
    // filterBuilder uses sanitized keys; unsanitize for SQL
    var unsanitizedField = field.replace(/__/g, '.');
    var sqlOp = op;
    if (op === '=') sqlOp = '=';
    if (op === '<>') sqlOp = '<>';
    if (op === 'contains') { sqlOp = 'LIKE'; val = '%' + val + '%'; }
    if (op === 'notcontains') { sqlOp = 'NOT LIKE'; val = '%' + val + '%'; }
    if (op === 'startswith') { sqlOp = 'LIKE'; val = String(val) + '%'; }
    if (op === 'endswith') { sqlOp = 'LIKE'; val = '%' + String(val); }
    if (typeof val === 'string') val = "'" + val.replace(/'/g, "''") + "'";
    return unsanitizedField + ' ' + sqlOp + ' ' + val;
  }

  // Helpers to generate SQL WHERE using JSON_VALUE(alias.Content, '$.path')
  function stringifyFilterForJson(expr) {
    if (!expr) return '';
    if (Array.isArray(expr)) {
      if (expr.length === 3 && typeof expr[0] === 'string') {
        return simplePredicateToSqlJson(expr);
      }
      var out = [];
      for (var i = 0; i < expr.length; i++) {
        var token = expr[i];
        if (Array.isArray(token)) {
          out.push('(' + stringifyFilterForJson(token) + ')');
        } else if (typeof token === 'string' && (token.toLowerCase() === 'and' || token.toLowerCase() === 'or')) {
          out.push(token.toUpperCase());
        }
      }
      return out.join(' ');
    }
    return '';
  }

  function simplePredicateToSqlJson(p) {
    var field = p[0];
    var op = p[1];
    var val = p[2];
    // support sanitized keys
    var unsanitizedField = String(field).indexOf('__') !== -1 ? String(field).replace(/__/g, '.') : String(field);
    var parts = unsanitizedField.split('.');
    var alias = parts.shift();
    var path = parts.join('.');
    var lhs = "JSON_VALUE(" + alias + ".Content, '$." + path + "')";
    var sqlOp = op;
    if (op === 'contains') { sqlOp = 'LIKE'; val = '%' + val + '%'; }
    if (op === 'notcontains') { sqlOp = 'NOT LIKE'; val = '%' + val + '%'; }
    if (op === 'startswith') { sqlOp = 'LIKE'; val = String(val) + '%'; }
    if (op === 'endswith') { sqlOp = 'LIKE'; val = '%' + String(val); }
    if (typeof val === 'string') val = "'" + String(val).replace(/'/g, "''") + "'";
    return lhs + ' ' + sqlOp + ' ' + val;
  }

  $(init);
})();


