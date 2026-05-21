const fs = require('fs');

const missingTranslations = {
  'uz': {
    'admin.suppliers.balance': 'Balans',
    'admin.suppliers.totalPaid': "Jami to'langan",
    'admin.suppliers.nameUz': "O'zbekcha nomi",
    'admin.suppliers.nameRu': "Ruscha nomi",
    'admin.common.search': "Qidiruv...",
    'pos.stockMatrix': "Zaxira",
    'admin.suppliers.totalDebt': "Jami qarz",
    'admin.suppliers.recordPayment': "To'lovni kiritish",
    'admin.suppliers.supplier': "Yetkazib beruvchi",
    'admin.suppliers.currentDebt': "Joriy qarz",
    'admin.suppliers.paymentAmount': "To'lov summasi",
    'admin.suppliers.transactions': "Tranzaksiyalar",
    'admin.suppliers.payment': "To'lov",
    'admin.suppliers.purchase': "Xarid",
    'admin.common.back': "Orqaga",
    'admin.catalog.priceOptional': "Ixtiyoriy"
  },
  'uz-cyrl': {
    'admin.suppliers.balance': 'Баланс',
    'admin.suppliers.totalPaid': 'Жами тўланган',
    'admin.suppliers.nameUz': 'Ўзбекча номи',
    'admin.suppliers.nameRu': 'Русча номи',
    'admin.common.search': 'Қидирув...',
    'pos.stockMatrix': 'Захира',
    'admin.suppliers.totalDebt': 'Жами қарз',
    'admin.suppliers.recordPayment': 'Тўловни киритиш',
    'admin.suppliers.supplier': 'Етказиб берувчи',
    'admin.suppliers.currentDebt': 'Жорий қарз',
    'admin.suppliers.paymentAmount': 'Тўлов суммаси',
    'admin.suppliers.transactions': 'Транзакциялар',
    'admin.suppliers.payment': 'Тўлов',
    'admin.suppliers.purchase': 'Харид',
    'admin.common.back': 'Орқага',
    'admin.catalog.priceOptional': 'Ихтиёрий'
  },
  'ru': {
    'admin.suppliers.balance': 'Баланс',
    'admin.suppliers.totalPaid': 'Всего оплачено',
    'admin.suppliers.nameUz': 'Название (Узб)',
    'admin.suppliers.nameRu': 'Название (Рус)',
    'admin.common.search': 'Поиск...',
    'pos.stockMatrix': 'Остатки',
    'admin.suppliers.totalDebt': 'Общий долг',
    'admin.suppliers.recordPayment': 'Внести платеж',
    'admin.suppliers.supplier': 'Поставщик',
    'admin.suppliers.currentDebt': 'Текущий долг',
    'admin.suppliers.paymentAmount': 'Сумма платежа',
    'admin.suppliers.transactions': 'Транзакции',
    'admin.suppliers.payment': 'Платеж',
    'admin.suppliers.purchase': 'Покупка',
    'admin.common.back': 'Назад',
    'admin.catalog.priceOptional': 'Необязательно'
  }
};

for (const [lang, translations] of Object.entries(missingTranslations)) {
  const filePath = './src/locales/' + lang + '.json';
  if (!fs.existsSync(filePath)) continue;
  
  const content = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(content);
  
  for (const [key, val] of Object.entries(translations)) {
    if (!data[key]) {
      data[key] = val;
    }
  }
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log('Updated ' + lang + '.json');
}
