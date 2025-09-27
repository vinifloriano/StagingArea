// Mocked tables. Each table has columns and rows. Rows emulate a backend JSON column expanded into fields
window.MockSchema = {
  tables: [
    {
      name: 'users',
      columns: [
        { name: 'id', type: 'number' },
        { name: 'name', type: 'string' },
        { name: 'email', type: 'string' },
        { name: 'country', type: 'string' },
        { name: 'created_at', type: 'date' }
      ],
      rows: [
        { id: 1, name: 'Alice', email: 'alice@example.com', country: 'US', created_at: '2024-01-02' },
        { id: 2, name: 'Bob', email: 'bob@example.com', country: 'DE', created_at: '2024-02-10' },
        { id: 3, name: 'Carlos', email: 'carlos@example.com', country: 'BR', created_at: '2024-03-05' },
        { id: 4, name: 'Diana', email: 'diana@example.com', country: 'US', created_at: '2024-04-18' }
      ]
    },
    {
      name: 'orders',
      columns: [
        { name: 'id', type: 'number' },
        { name: 'user_id', type: 'number' },
        { name: 'status', type: 'string' },
        { name: 'amount', type: 'number' },
        { name: 'ordered_at', type: 'date' }
      ],
      rows: [
        { id: 101, user_id: 1, status: 'paid', amount: 120.5, ordered_at: '2024-05-01' },
        { id: 102, user_id: 1, status: 'pending', amount: 49.9, ordered_at: '2024-05-12' },
        { id: 103, user_id: 2, status: 'paid', amount: 15.0, ordered_at: '2024-05-20' },
        { id: 104, user_id: 3, status: 'cancelled', amount: 81.2, ordered_at: '2024-06-02' }
      ]
    },
    {
      name: 'payments',
      columns: [
        { name: 'id', type: 'number' },
        { name: 'order_id', type: 'number' },
        { name: 'method', type: 'string' },
        { name: 'paid_at', type: 'date' }
      ],
      rows: [
        { id: 9001, order_id: 101, method: 'card', paid_at: '2024-05-01' },
        { id: 9002, order_id: 103, method: 'paypal', paid_at: '2024-05-20' }
      ]
    }
  ]
};

// Helper: get table by name
window.getTable = function(tableName) {
  return window.MockSchema.tables.find(function(t) { return t.name === tableName; });
};


