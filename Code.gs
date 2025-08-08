// Основной файл Code.gs для Google Apps Script - УЛУЧШЕННАЯ ВЕРСИЯ С TIKTOK МЕТРИКАМИ

/**
 * Функция получения данных за SQL запитом из БД - ВОЗВРАЩАЕТ ДАННЫЕ НАПРЯМУЮ
 * @param {string} strSQL - SQL запит
 * @return {Array|Object} - массив данных или объект с ошибкой
 */
function getDataBySql(strSQL = "SELECT * FROM `ads_collection` WHERE `source` = 'tiktok'") {
  try {
    // === 1. Надсилаємо POST запит до PHP бекенду ===
    const url = 'https://api.trll-notif.com.ua/adsreportcollector/core.php';

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ sql: strSQL }),
      muteHttpExceptions: true,
    };

    console.log('🔍 Sending request to database API...');
    const response = UrlFetchApp.fetch(url, options);
    
    // Проверяем HTTP статус
    if (response.getResponseCode() !== 200) {
      return { error: `HTTP ${response.getResponseCode()}: Сервер базы данных недоступен` };
    }
    
    const responseText = response.getContentText();
    if (!responseText || responseText.trim() === '') {
      return { error: 'Пустой ответ от сервера базы данных' };
    }
    
    let json;
    try {
      json = JSON.parse(responseText);
    } catch (parseError) {
      return { error: 'Неверный формат ответа от сервера: ' + parseError.message };
    }

    // === 2. Обробка відповіді від бекенду ===
    if (json.error) {
      return { error: json.error };
    }

    if (!json || !Array.isArray(json) || json.length === 0) {
      return { error: 'empty data' };
    }

    // === 3. Повертаємо дані напряму (БЕЗ створення листів) ===
    const data = json;
    
    // Перетворюємо в формат, який очікує функція parseDbResults
    if (typeof data[0] === 'object' && !Array.isArray(data[0])) {
      // Якщо це масив об'єктів, перетворюємо в формат [headers, ...rows]
      const headers = Object.keys(data[0]);
      const rows = data.map(row => headers.map(h => row[h]));
      console.log('✅ Successfully processed', rows.length, 'data rows');
      return [headers, ...rows];
    } else {
      // Якщо вже масив масивів
      console.log('✅ Successfully received', data.length, 'data rows');
      return data;
    }

  } catch (error) {
    console.error('❌ Ошибка в getDataBySql:', error);
    return { error: 'Ошибка подключения: ' + error.message };
  }
}

/**
 * Функция для парсинга названия кампании
 */
function parseCampaignName(fullName) {
  const result = {
    article: '',
    productName: '',
    buyer: '',
    source: '',
    account: ''
  };
  
  if (!fullName || typeof fullName !== 'string') {
    return result;
  }
  
  try {
    // Ищем артикул в начале (буквы + цифры)
    const articleMatch = fullName.match(/^([A-Z]+\d+)/);
    if (articleMatch) {
      result.article = articleMatch[1];
    }
    
    // Разделяем по " | "
    const parts = fullName.split(' | ');
    
    if (parts.length >= 2) {
      // Извлекаем имя байера (второй элемент после разделения)
      result.buyer = parts[1].trim();
      
      if (parts.length >= 3) {
        // Третий элемент содержит источник + аккаунт
        const sourceAccountPart = parts[2].trim();
        
        // Ищем аккаунт (обычно VL + цифры в начале строки после источника)
        const accountMatch = sourceAccountPart.match(/\b(VL\d+|[A-Z]+\d+)\b/);
        if (accountMatch) {
          result.account = accountMatch[1];
          // Источник - это часть до аккаунта
          result.source = sourceAccountPart.replace(accountMatch[0], '').trim();
        } else {
          result.source = sourceAccountPart;
        }
      }
    }
    
    // Извлекаем название товара (между артикулом и первым " | ")
    if (parts.length >= 1) {
      const firstPart = parts[0];
      const productMatch = firstPart.replace(result.article, '').trim();
      if (productMatch.startsWith(' ')) {
        result.productName = productMatch.substring(1).replace(/\s*-\s*$/, '').trim();
      }
    }
    
  } catch (e) {
    console.log('Ошибка парсинга названия кампании:', fullName, e);
  }
  
  return result;
}

/**
 * Функция для веб-приложения
 */
function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setTitle('Аналитика TikTok Ads');
}

/**
 * Функция для подключения внешних файлов
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Основная функция для построения аналитики - УЛУЧШЕННАЯ С TIKTOK МЕТРИКАМИ
 */
function buildChartForArticle(article, periodStart, periodEnd) {
  try {
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    function formatValueByRow(value, rowIndex) {
      // Для названий рекламы (индекс 23), URL (24) и бюджета (25) возвращаем как строку
      if (rowIndex === 23 || rowIndex === 24 || rowIndex === 25) {
        return value ? String(value).trim() : '';
      }
      
      const strVal = String(value || '').replace(',', '.');
      const num = parseFloat(strVal);
      if (isNaN(num)) return value ? String(value) : '';
      
      switch (rowIndex) {
        case 17: case 18: case 19: case 21: case 22:
          return num.toFixed(2).replace('.', ',');
        case 20: case 26:
          return String(Math.floor(num));
        default:
          return num.toFixed(2).replace('.', ',');
      }
    }

    function sumMultilineValues(valuesArray) {
      if (!Array.isArray(valuesArray)) return 0;
      
      let totalSum = 0;
      valuesArray.forEach(val => {
        if (val !== undefined && val !== null && val !== '') {
          const lines = String(val).split('\n');
          lines.forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine !== '') {
              const num = Number(trimmedLine) || 0;
              totalSum += num;
            }
          });
        }
      });
      
      return totalSum;
    }

    function processDayValues(arr, rowIndex) {
      if (!Array.isArray(arr)) {
        return '';
      }
      
      // Фильтруем пустые значения и убираем дубликаты для строковых полей
      let valuesToConvert;
      if (rowIndex === 24 || rowIndex === 25) {
        // URL и Бюджет - убираем дубликаты
        valuesToConvert = Array.from(new Set(arr.filter(v => v !== undefined && v !== null && v !== '')));
      } else if (rowIndex === 23) {
        // Название рекламы - убираем дубликаты и фильтруем пустые
        valuesToConvert = Array.from(new Set(arr.filter(v => v !== undefined && v !== null && v !== '' && String(v).trim() !== '')));
      } else {
        // Числовые поля - оставляем все значения
        valuesToConvert = arr.filter(v => v !== undefined && v !== null && v !== '');
      }
      
      return valuesToConvert.map(v => formatValueByRow(v, rowIndex)).join('\n');
    }

    function calculateRating(cpl, ratingThreshold) {
      if (cpl === 0 || isNaN(cpl) || ratingThreshold === 0) return "";
      
      const percentage = (cpl / ratingThreshold) * 100;
      
      if (percentage <= 35) return "A";
      else if (percentage <= 65) return "B";
      else if (percentage <= 90) return "C";
      else return "D";
    }

    function parseSeason(seasonEmoji) {
      if (!seasonEmoji || seasonEmoji.trim() === '') return 'Неизвестно';
      
      const seasonString = seasonEmoji.trim();
      
      // Проверяем на всесезон (все 4 эмодзи)
      if (seasonString.includes('☀️') && seasonString.includes('🍁') && 
          seasonString.includes('❄️') && seasonString.includes('🌱')) {
        return 'Всесезон';
      }
      
      const seasons = [];
      if (seasonString.includes('☀️')) seasons.push('Лето');
      if (seasonString.includes('🍁')) seasons.push('Осень');
      if (seasonString.includes('❄️')) seasons.push('Зима');
      if (seasonString.includes('🌱')) seasons.push('Весна');
      
      return seasons.length > 0 ? seasons.join(', ') : 'Неизвестно';
    }

    // УЛУЧШЕННАЯ функция получения данных из БД с понятными ошибками
    function getDataFromDatabase(sqlQuery) {
      try {
        console.log('Executing SQL query...');
        const result = getDataBySql(sqlQuery);
        
        // Проверяем на ошибки от API
        if (result && typeof result === 'object' && result.error) {
          if (result.error === 'empty data') {
            throw new Error('EMPTY_DATA');
          }
          throw new Error(`🚨 Ошибка API базы данных!\n\nКод ошибки: ${result.error}\n\nОбратитесь к администратору системы.`);
        }
        
        // Проверяем, что получили массив данных
        if (!Array.isArray(result)) {
          throw new Error('🔧 Неверный формат данных!\n\nПолучен неожиданный тип данных от сервера.\nОбратитесь к разработчику.');
        }
        
        if (result.length === 0) {
          throw new Error('EMPTY_DATA');
        }
        
        console.log('✅ Data received successfully:', result.length, 'rows');
        return result;
        
      } catch (error) {
        console.error('❌ Error getting data from database:', error);
        throw error;
      }
    }

    function parseDbResults(data) {
      if (!data || data.length < 2) return [];
      
      const headers = data[0];
      const rows = data.slice(1);
      
      return rows.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index];
        });
        return obj;
      });
    }

    if (!article || article.trim() === '') {
      throw new Error('Артикул не может быть пустым');
    }

    console.log('Starting analysis for article:', article);

    // Проверяем период
    let periodChosen = false, periodStartDate, periodEndDate;
    if (periodStart && periodEnd) {
      periodChosen = true;
      periodStartDate = new Date(periodStart);
      periodEndDate = new Date(periodEnd);
      console.log('Period selected:', periodStart, 'to', periodEnd);
    }

    // Получаем данные из КАПЫ 3.0 (если доступны)
    let maxCPLThreshold = 3.5;
    let status = 'Активный';
    let stock = 'Не указано';
    let stockDays = 'Не указано';
    let season = 'Неизвестно';
    let category = 'Не указана';
    let efficiencyZoneFormatted = {
      value: '--,--%',
      backgroundColor: '#f3f3f3',
      fontColor: '#666666'
    };
    let zoneABFormatted = '-';
    let zoneACFormatted = '-';
    let zoneADFormatted = '-';
    let zoneAEFormatted = '-';

    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheetKapy = ss.getSheetByName('КАПЫ 3.0');
      
      if (sheetKapy) {
        console.log('Reading data from КАПЫ 3.0 sheet...');
        const kapyData = sheetKapy.getDataRange().getValues();
        let articleRow = null;
        
        for (let i = 0; i < kapyData.length; i++) {
          const cellValue = String(kapyData[i][1] || '').trim();
          if (cellValue === article.trim()) {
            articleRow = i + 1;
            break;
          }
        }

        if (articleRow) {
          console.log('Found article in КАПЫ 3.0 at row:', articleRow);
          const rawAB = sheetKapy.getRange(articleRow, 28).getValue();
          const rawAF = sheetKapy.getRange(articleRow, 32).getValue();
          maxCPLThreshold = (rawAB !== '' && !isNaN(rawAB)) ? Number(rawAB) : 
                           (rawAF !== '' && !isNaN(rawAF)) ? Number(rawAF) : 3.5;

          status = String(sheetKapy.getRange(articleRow, 4).getValue() || 'Активный').trim();
          const stockValue = sheetKapy.getRange(articleRow, 34).getValue();
          const stockDaysValue = sheetKapy.getRange(articleRow, 33).getValue();
          const seasonEmoji = String(sheetKapy.getRange(articleRow, 39).getValue() || '').trim();
          const categoryValue = String(sheetKapy.getRange(articleRow, 44).getValue() || '').trim();
          
          stock = stockValue !== null && stockValue !== undefined && stockValue !== '' ? 
            String(stockValue) : 'Не указано';
          stockDays = stockDaysValue !== null && stockDaysValue !== undefined && stockDaysValue !== '' ? 
            String(stockDaysValue) : 'Не указано';
          season = parseSeason(seasonEmoji);
          category = categoryValue || 'Не указана';

          // Зоны эффективности
          const efficiencyZoneValue = sheetKapy.getRange(articleRow, 27).getValue();
          const zoneAB = sheetKapy.getRange(articleRow, 28).getValue();
          const zoneAC = sheetKapy.getRange(articleRow, 29).getValue();
          const zoneAD = sheetKapy.getRange(articleRow, 30).getValue();
          const zoneAE = sheetKapy.getRange(articleRow, 31).getValue();
          
          // ЧИТАЕМ ЦВЕТА ИЗ ЯЧЕЙКИ AA (колонка 27) - ДИНАМИЧЕСКИ!
          const efficiencyZoneCell = sheetKapy.getRange(articleRow, 27);
          let zoneBackgroundColor = null;
          let zoneFontColor = null;
          
          try {
            // Получаем цвет фона ячейки
            zoneBackgroundColor = efficiencyZoneCell.getBackground();
            // Получаем цвет шрифта ячейки  
            zoneFontColor = efficiencyZoneCell.getFontColor();
            console.log('Zone colors from sheet - Background:', zoneBackgroundColor, 'Font:', zoneFontColor);
          } catch (colorError) {
            console.log('Error reading cell colors:', colorError);
            zoneBackgroundColor = '#f3f3f3';
            zoneFontColor = '#666666';
          }
          
          efficiencyZoneFormatted = (efficiencyZoneValue !== null && efficiencyZoneValue !== undefined && efficiencyZoneValue !== '') ? 
            (Number(efficiencyZoneValue) * 100).toFixed(2).replace('.', ',') + '%' : '--,--%';
          
          zoneABFormatted = (zoneAB !== null && zoneAB !== undefined && zoneAB !== '') ? 
            Number(zoneAB).toFixed(2).replace('.', ',') : '-';
          zoneACFormatted = (zoneAC !== null && zoneAC !== undefined && zoneAC !== '') ? 
            Number(zoneAC).toFixed(2).replace('.', ',') : '-';  
          zoneADFormatted = (zoneAD !== null && zoneAD !== undefined && zoneAD !== '') ? 
            Number(zoneAD).toFixed(2).replace('.', ',') : '-';
          zoneAEFormatted = (zoneAE !== null && zoneAE !== undefined && zoneAE !== '') ? 
            Number(zoneAE).toFixed(2).replace('.', ',') : '-';
            
          // Сохраняем цвета для передачи в интерфейс
          efficiencyZoneFormatted = {
            value: (efficiencyZoneValue !== null && efficiencyZoneValue !== undefined && efficiencyZoneValue !== '') ? 
              (Number(efficiencyZoneValue) * 100).toFixed(2).replace('.', ',') + '%' : '--,--%',
            backgroundColor: zoneBackgroundColor || '#f3f3f3',
            fontColor: zoneFontColor || '#666666'
          };
        } else {
          console.log('Article not found in КАПЫ 3.0');
        }
      } else {
        console.log('КАПЫ 3.0 sheet not found');
      }
    } catch (e) {
      console.log('Ошибка при получении данных из КАПЫ 3.0:', e);
    }

    const displayMaxCPL = maxCPLThreshold;
    const displayCPL_ROI_minus5 = maxCPLThreshold;

    // ПОСТРОЕНИЕ ЕДИНОГО SQL ЗАПРОСА
    let dateFilter = '';
    if (periodChosen) {
      const startDateStr = Utilities.formatDate(periodStartDate, 'Europe/Kiev', 'yyyy-MM-dd');
      const endDateStr = Utilities.formatDate(periodEndDate, 'Europe/Kiev', 'yyyy-MM-dd');
      dateFilter = ` AND \`adv_date\` >= '${startDateStr}' AND \`adv_date\` <= '${endDateStr}'`;
    }

    // ОБЪЕДИНЕННЫЙ SQL запрос для получения всех данных одним запросом
    const combinedSql = `
      SELECT 
        campaign_name,
        campaign_name_tracker,
        adv_group_name,
        adv_name,
        adv_date,
        adv_group_id,
        campaign_id,
        target_url,
        adv_id,
        cpc,
        cpm,
        clicks_on_link,
        ctr,
        frequency,
        average_time_on_video,
        valid_cpa,
        valid,
        cost,
        valid_cr,
        clicks_on_link_tracker,
        viewed_tracker,
        cpc_tracker,
        fraud,
        fraud_cpa
      FROM \`ads_collection\`
      WHERE \`source\` = 'tiktok' 
        AND (\`campaign_name\` LIKE '${article}%' OR \`campaign_name_tracker\` LIKE '${article}%')${dateFilter}
      ORDER BY adv_date
    `;

    // Получение данных из БД - ОДНИМ ЗАПРОСОМ
    console.log('Fetching all data with combined query...');
    let allData;
    
    try {
      allData = getDataFromDatabase(combinedSql);
      if (!allData || allData.length === 0) {
        throw new Error(`📊 Данные не найдены!\n\nАртикул "${article}" не найден в базе данных.\n\nВозможные причины:\n• Проверьте правильность написания артикула\n• Артикул еще не добавлен в систему\n• Нет активных кампаний за выбранный период`);
      }
    } catch (error) {
      if (error.message.includes('📊')) {
        throw error; // Перебрасываем наши пользовательские ошибки как есть
      }
      throw new Error(`🔌 Ошибка подключения к базе данных!\n\nТехническая информация: ${error.message}\n\nПопробуйте:\n• Обновить страницу\n• Проверить подключение к интернету\n• Обратиться к администратору`);
    }

    // Парсинг данных
    console.log('Parsing database results...');
    const allRows = parseDbResults(allData);
    
    // Разделяем данные на TikTok и трекер
    const tiktokRows = allRows.filter(row => row.campaign_name && row.campaign_name.includes(article));
    const trackerRows = allRows.filter(row => row.campaign_name_tracker && row.campaign_name_tracker.includes(article));

    console.log('TikTok rows:', tiktokRows.length);
    console.log('Tracker rows:', trackerRows.length);

    if (tiktokRows.length === 0 && trackerRows.length === 0) {
      throw new Error(`📊 Данные не найдены!\n\nПо артикулу "${article}" нет данных за указанный период.\n\nВозможные причины:\n• Кампании еще не запускались\n• Данные еще не обновились в системе\n• Проверьте выбранный период дат`);
    }

    // Собираем данные
    console.log('Processing data...');
    let minDate = null, maxDate = null;
    const resultMap = {};
    const resultMapByGroupId = {};
    const resultMapByGroup = {};
    const resultMapByBuyer = {};
    const resultMapByAccount = {};
    // НОВАЯ СТРУКТУРА: Байер -> Группа объявлений
    const resultMapByBuyerGroup = {};
    const fbDataMap = {};
    const fbDataMapByGroupId = {};
    const fbDataMapByGroup = {};
    const fbDataMapByBuyer = {};
    const fbDataMapByAccount = {};
    // НОВАЯ СТРУКТУРА: Байер -> Группа объявлений (для TikTok данных)
    const fbDataMapByBuyerGroup = {};
    const groupsByDate = {};
    const buyersByDate = {};
    const accountsByDate = {};
    const globalGroups = new Set();
    const globalBuyers = new Set();
    const globalAccounts = new Set();
    const groupIdToNameMap = {};
    // НОВАЯ СТРУКТУРА: Отслеживание групп по байерам
    const buyerGroupsMap = {}; // { buyer: Set(groups) }
    let totalLeadsAll = 0, totalClicksAll = 0;
    const globalVideos = new Set(), globalSites = new Set();

    // Обработка данных трекера
    trackerRows.forEach(row => {
      const fullName = String(row.campaign_name_tracker || '').trim();
      const dateObj = new Date(row.adv_date);
      if (isNaN(dateObj.getTime())) return;
      
      const campaignInfo = parseCampaignName(fullName);
      if (campaignInfo.article !== article) return;
      
      const dateStr = Utilities.formatDate(dateObj, 'Europe/Kiev', 'yyyy-MM-dd');
      const groupId = String(row.adv_group_id || '').trim();
      const leads = Number(row.valid) || 0;
      const spend = Number(row.cost) || 0;
      const siteClicks = Number(row.clicks_on_link_tracker) || 0;

      if (!resultMap[dateStr]) resultMap[dateStr] = { leads: 0, spend: 0 };
      resultMap[dateStr].leads += leads;
      resultMap[dateStr].spend += spend;

      if (!resultMapByGroupId[groupId]) resultMapByGroupId[groupId] = {};
      if (!resultMapByGroupId[groupId][dateStr]) resultMapByGroupId[groupId][dateStr] = { leads: 0, spend: 0 };
      resultMapByGroupId[groupId][dateStr].leads += leads;
      resultMapByGroupId[groupId][dateStr].spend += spend;

      // По байерам
      if (campaignInfo.buyer) {
        if (!resultMapByBuyer[campaignInfo.buyer]) resultMapByBuyer[campaignInfo.buyer] = {};
        if (!resultMapByBuyer[campaignInfo.buyer][dateStr]) resultMapByBuyer[campaignInfo.buyer][dateStr] = { leads: 0, spend: 0 };
        resultMapByBuyer[campaignInfo.buyer][dateStr].leads += leads;
        resultMapByBuyer[campaignInfo.buyer][dateStr].spend += spend;
        globalBuyers.add(campaignInfo.buyer);
        
        if (!buyersByDate[dateStr]) buyersByDate[dateStr] = [];
        buyersByDate[dateStr].push(campaignInfo.buyer);
        
        // НОВАЯ СТРУКТУРА: Байер -> Группа (по ID группы)
        if (groupId) {
          const buyerGroupKey = `${campaignInfo.buyer}:::${groupId}`;
          if (!resultMapByBuyerGroup[buyerGroupKey]) resultMapByBuyerGroup[buyerGroupKey] = {};
          if (!resultMapByBuyerGroup[buyerGroupKey][dateStr]) resultMapByBuyerGroup[buyerGroupKey][dateStr] = { leads: 0, spend: 0 };
          resultMapByBuyerGroup[buyerGroupKey][dateStr].leads += leads;
          resultMapByBuyerGroup[buyerGroupKey][dateStr].spend += spend;
          
          // Отслеживаем группы для каждого байера
          if (!buyerGroupsMap[campaignInfo.buyer]) buyerGroupsMap[campaignInfo.buyer] = new Set();
          buyerGroupsMap[campaignInfo.buyer].add(groupId);
        }
      }

      // По аккаунтам
      if (campaignInfo.account) {
        if (!resultMapByAccount[campaignInfo.account]) resultMapByAccount[campaignInfo.account] = {};
        if (!resultMapByAccount[campaignInfo.account][dateStr]) resultMapByAccount[campaignInfo.account][dateStr] = { leads: 0, spend: 0 };
        resultMapByAccount[campaignInfo.account][dateStr].leads += leads;
        resultMapByAccount[campaignInfo.account][dateStr].spend += spend;
        globalAccounts.add(campaignInfo.account);
        
        if (!accountsByDate[dateStr]) accountsByDate[dateStr] = [];
        accountsByDate[dateStr].push(campaignInfo.account);
      }

      totalLeadsAll += leads;
      totalClicksAll += siteClicks;

      if (!minDate || dateObj < minDate) minDate = dateObj;
      if (!maxDate || dateObj > maxDate) maxDate = dateObj;
    });

    // Обработка данных TikTok - УЛУЧШЕННАЯ С БАЙЕР-ГРУППА СТРУКТУРОЙ
    console.log('Processing TikTok data...');
    tiktokRows.forEach(row => {
      const fullName = String(row.campaign_name || '').trim();
      const groupName = String(row.adv_group_name || '').trim();
      const groupId = String(row.adv_group_id || '').trim();
      const advName = String(row.adv_name || '').trim();
      const dateObj = new Date(row.adv_date);
      if (isNaN(dateObj.getTime())) return;
      
      const campaignInfo = parseCampaignName(fullName);
      if (campaignInfo.article !== article) return;
      
      const dateStr = Utilities.formatDate(dateObj, 'Europe/Kiev', 'yyyy-MM-dd');

      // Создаем маппинг ID → название группы
      if (groupId && groupName) {
        groupIdToNameMap[groupId] = groupName;
        globalGroups.add(groupName);
      }

      // Собираем группы для каждой даты
      if (!groupsByDate[dateStr]) groupsByDate[dateStr] = [];
      groupsByDate[dateStr].push(groupName);

      // Инициализация общих TikTok данных
      if (!fbDataMap[dateStr]) {
        fbDataMap[dateStr] = {
          adId: [], freq: [], ctr: [], cpm: [], linkClicks: [],
          cpc: [], avgWatchTime: [], videoName: [], siteUrl: [], budget: []
        };
      }
      
      // TikTok данные
      fbDataMap[dateStr].adId.push(row.adv_id !== undefined && row.adv_id !== null ? String(row.adv_id) : '');
      fbDataMap[dateStr].freq.push(row.frequency !== undefined && row.frequency !== null ? String(row.frequency) : '');
      fbDataMap[dateStr].ctr.push(row.ctr !== undefined && row.ctr !== null ? String(row.ctr) : '');
      fbDataMap[dateStr].cpm.push(row.cpm !== undefined && row.cpm !== null ? String(row.cpm) : '');
      fbDataMap[dateStr].linkClicks.push(row.clicks_on_link !== undefined && row.clicks_on_link !== null ? String(row.clicks_on_link) : '');
      fbDataMap[dateStr].cpc.push(row.cpc !== undefined && row.cpc !== null ? String(row.cpc) : '');
      fbDataMap[dateStr].avgWatchTime.push(row.average_time_on_video !== undefined && row.average_time_on_video !== null ? String(row.average_time_on_video) : '');
      fbDataMap[dateStr].videoName.push(row.adv_name !== undefined && row.adv_name !== null && row.adv_name !== '' ? String(row.adv_name).trim() : '');
      fbDataMap[dateStr].siteUrl.push(row.target_url !== undefined && row.target_url !== null && row.target_url !== '' ? String(row.target_url).trim() : '');
      fbDataMap[dateStr].budget.push('');

      // По ID группы
      if (!fbDataMapByGroupId[groupId]) fbDataMapByGroupId[groupId] = {};
      if (!fbDataMapByGroupId[groupId][dateStr]) {
        fbDataMapByGroupId[groupId][dateStr] = {
          adId: [], freq: [], ctr: [], cpm: [], linkClicks: [],
          cpc: [], avgWatchTime: [], videoName: [], siteUrl: [], budget: []
        };
      }
      fbDataMapByGroupId[groupId][dateStr].adId.push(row.adv_id !== undefined && row.adv_id !== null ? String(row.adv_id) : '');
      fbDataMapByGroupId[groupId][dateStr].freq.push(row.frequency !== undefined && row.frequency !== null ? String(row.frequency) : '');
      fbDataMapByGroupId[groupId][dateStr].ctr.push(row.ctr !== undefined && row.ctr !== null ? String(row.ctr) : '');
      fbDataMapByGroupId[groupId][dateStr].cpm.push(row.cpm !== undefined && row.cpm !== null ? String(row.cpm) : '');
      fbDataMapByGroupId[groupId][dateStr].linkClicks.push(row.clicks_on_link !== undefined && row.clicks_on_link !== null ? String(row.clicks_on_link) : '');
      fbDataMapByGroupId[groupId][dateStr].cpc.push(row.cpc !== undefined && row.cpc !== null ? String(row.cpc) : '');
      fbDataMapByGroupId[groupId][dateStr].avgWatchTime.push(row.average_time_on_video !== undefined && row.average_time_on_video !== null ? String(row.average_time_on_video) : '');
      fbDataMapByGroupId[groupId][dateStr].videoName.push(row.adv_name !== undefined && row.adv_name !== null && row.adv_name !== '' ? String(row.adv_name).trim() : '');
      fbDataMapByGroupId[groupId][dateStr].siteUrl.push(row.target_url !== undefined && row.target_url !== null && row.target_url !== '' ? String(row.target_url).trim() : '');
      fbDataMapByGroupId[groupId][dateStr].budget.push('');

      // По байерам
      if (campaignInfo.buyer) {
        if (!fbDataMapByBuyer[campaignInfo.buyer]) fbDataMapByBuyer[campaignInfo.buyer] = {};
        if (!fbDataMapByBuyer[campaignInfo.buyer][dateStr]) {
          fbDataMapByBuyer[campaignInfo.buyer][dateStr] = {
            adId: [], freq: [], ctr: [], cpm: [], linkClicks: [],
            cpc: [], avgWatchTime: [], videoName: [], siteUrl: [], budget: []
          };
        }
        fbDataMapByBuyer[campaignInfo.buyer][dateStr].adId.push(row.adv_id !== undefined && row.adv_id !== null ? String(row.adv_id) : '');
        fbDataMapByBuyer[campaignInfo.buyer][dateStr].freq.push(row.frequency !== undefined && row.frequency !== null ? String(row.frequency) : '');
        fbDataMapByBuyer[campaignInfo.buyer][dateStr].ctr.push(row.ctr !== undefined && row.ctr !== null ? String(row.ctr) : '');
        fbDataMapByBuyer[campaignInfo.buyer][dateStr].cpm.push(row.cpm !== undefined && row.cpm !== null ? String(row.cpm) : '');
        fbDataMapByBuyer[campaignInfo.buyer][dateStr].linkClicks.push(row.clicks_on_link !== undefined && row.clicks_on_link !== null ? String(row.clicks_on_link) : '');
        fbDataMapByBuyer[campaignInfo.buyer][dateStr].cpc.push(row.cpc !== undefined && row.cpc !== null ? String(row.cpc) : '');
        fbDataMapByBuyer[campaignInfo.buyer][dateStr].avgWatchTime.push(row.average_time_on_video !== undefined && row.average_time_on_video !== null ? String(row.average_time_on_video) : '');
        fbDataMapByBuyer[campaignInfo.buyer][dateStr].videoName.push(row.adv_name !== undefined && row.adv_name !== null && row.adv_name !== '' ? String(row.adv_name).trim() : '');
        fbDataMapByBuyer[campaignInfo.buyer][dateStr].siteUrl.push(row.target_url !== undefined && row.target_url !== null && row.target_url !== '' ? String(row.target_url).trim() : '');
        fbDataMapByBuyer[campaignInfo.buyer][dateStr].budget.push('');
        
        // НОВОЕ: По байер-группам
        if (groupId) {
          const buyerGroupKey = `${campaignInfo.buyer}:::${groupId}`;
          if (!fbDataMapByBuyerGroup[buyerGroupKey]) fbDataMapByBuyerGroup[buyerGroupKey] = {};
          if (!fbDataMapByBuyerGroup[buyerGroupKey][dateStr]) {
            fbDataMapByBuyerGroup[buyerGroupKey][dateStr] = {
              adId: [], freq: [], ctr: [], cpm: [], linkClicks: [],
              cpc: [], avgWatchTime: [], videoName: [], siteUrl: [], budget: []
            };
          }
          fbDataMapByBuyerGroup[buyerGroupKey][dateStr].adId.push(row.adv_id !== undefined && row.adv_id !== null ? String(row.adv_id) : '');
          fbDataMapByBuyerGroup[buyerGroupKey][dateStr].freq.push(row.frequency !== undefined && row.frequency !== null ? String(row.frequency) : '');
          fbDataMapByBuyerGroup[buyerGroupKey][dateStr].ctr.push(row.ctr !== undefined && row.ctr !== null ? String(row.ctr) : '');
          fbDataMapByBuyerGroup[buyerGroupKey][dateStr].cpm.push(row.cpm !== undefined && row.cpm !== null ? String(row.cpm) : '');
          fbDataMapByBuyerGroup[buyerGroupKey][dateStr].linkClicks.push(row.clicks_on_link !== undefined && row.clicks_on_link !== null ? String(row.clicks_on_link) : '');
          fbDataMapByBuyerGroup[buyerGroupKey][dateStr].cpc.push(row.cpc !== undefined && row.cpc !== null ? String(row.cpc) : '');
          fbDataMapByBuyerGroup[buyerGroupKey][dateStr].avgWatchTime.push(row.average_time_on_video !== undefined && row.average_time_on_video !== null ? String(row.average_time_on_video) : '');
          fbDataMapByBuyerGroup[buyerGroupKey][dateStr].videoName.push(row.adv_name !== undefined && row.adv_name !== null && row.adv_name !== '' ? String(row.adv_name).trim() : '');
          fbDataMapByBuyerGroup[buyerGroupKey][dateStr].siteUrl.push(row.target_url !== undefined && row.target_url !== null && row.target_url !== '' ? String(row.target_url).trim() : '');
          fbDataMapByBuyerGroup[buyerGroupKey][dateStr].budget.push('');
        }
      }

      // По аккаунтам
      if (campaignInfo.account) {
        if (!fbDataMapByAccount[campaignInfo.account]) fbDataMapByAccount[campaignInfo.account] = {};
        if (!fbDataMapByAccount[campaignInfo.account][dateStr]) {
          fbDataMapByAccount[campaignInfo.account][dateStr] = {
            adId: [], freq: [], ctr: [], cpm: [], linkClicks: [],
            cpc: [], avgWatchTime: [], videoName: [], siteUrl: [], budget: []
          };
        }
        fbDataMapByAccount[campaignInfo.account][dateStr].adId.push(row.adv_id !== undefined && row.adv_id !== null ? String(row.adv_id) : '');
        fbDataMapByAccount[campaignInfo.account][dateStr].freq.push(row.frequency !== undefined && row.frequency !== null ? String(row.frequency) : '');
        fbDataMapByAccount[campaignInfo.account][dateStr].ctr.push(row.ctr !== undefined && row.ctr !== null ? String(row.ctr) : '');
        fbDataMapByAccount[campaignInfo.account][dateStr].cpm.push(row.cpm !== undefined && row.cpm !== null ? String(row.cpm) : '');
        fbDataMapByAccount[campaignInfo.account][dateStr].linkClicks.push(row.clicks_on_link !== undefined && row.clicks_on_link !== null ? String(row.clicks_on_link) : '');
        fbDataMapByAccount[campaignInfo.account][dateStr].cpc.push(row.cpc !== undefined && row.cpc !== null ? String(row.cpc) : '');
        fbDataMapByAccount[campaignInfo.account][dateStr].avgWatchTime.push(row.average_time_on_video !== undefined && row.average_time_on_video !== null ? String(row.average_time_on_video) : '');
        fbDataMapByAccount[campaignInfo.account][dateStr].videoName.push(row.adv_name !== undefined && row.adv_name !== null && row.adv_name !== '' ? String(row.adv_name).trim() : '');
        fbDataMapByAccount[campaignInfo.account][dateStr].siteUrl.push(row.target_url !== undefined && row.target_url !== null && row.target_url !== '' ? String(row.target_url).trim() : '');
        fbDataMapByAccount[campaignInfo.account][dateStr].budget.push('');
      }

      if (row.adv_name && row.adv_name !== undefined && row.adv_name !== null && row.adv_name !== '') {
        globalVideos.add(String(row.adv_name).trim());
      }
      if (row.target_url && row.target_url !== undefined && row.target_url !== null && row.target_url !== '') {
        globalSites.add(String(row.target_url).trim());
      }
    });

    // Заполняем resultMapByGroup на основе связки ID → название группы
    Object.keys(groupIdToNameMap).forEach(groupId => {
      const groupName = groupIdToNameMap[groupId];
      if (resultMapByGroupId[groupId]) {
        resultMapByGroup[groupName] = resultMapByGroupId[groupId];
      }
    });

    // Заполняем fbDataMapByGroup на основе связки ID → название группы
    Object.keys(groupIdToNameMap).forEach(groupId => {
      const groupName = groupIdToNameMap[groupId];
      if (fbDataMapByGroupId[groupId]) {
        fbDataMapByGroup[groupName] = fbDataMapByGroupId[groupId];
      }
    });

    if (!minDate) {
      throw new Error(`📊 Нет активных данных!\n\nПо артикулу "${article}" не найдено активных периодов.\n\nУбедитесь, что:\n• Артикул написан правильно\n• Кампании имели расходы\n• Выбран корректный период`);
    }

    if (periodChosen) {
      minDate = periodStartDate;
      maxDate = periodEndDate;
    }

    // Массив дат - только активные даты
    let firstActiveDate = null, lastActiveDate = null;
    
    let curDate = new Date(minDate);
    while (curDate <= maxDate) {
      const dateKey = Utilities.formatDate(curDate, 'Europe/Kiev', 'yyyy-MM-dd');
      const rec = resultMap[dateKey] || { leads: 0, spend: 0 };
      
      if (rec.spend > 0) {
        if (!firstActiveDate) firstActiveDate = new Date(curDate);
        lastActiveDate = new Date(curDate);
      }
      
      curDate.setDate(curDate.getDate() + 1);
    }

    const allDates = [];
    if (firstActiveDate && lastActiveDate) {
      curDate = new Date(firstActiveDate);
      while (curDate <= lastActiveDate) {
        allDates.push(new Date(curDate));
        curDate.setDate(curDate.getDate() + 1);
      }
    }

    // Функция для обработки сегмента - ОБНОВЛЕННАЯ С TIKTOK ДАННЫМИ
    function processSegment(segmentName, resultMapBySegment, fbDataMapBySegment, segmentType) {
      let segmentMinDate = null, segmentMaxDate = null;
      
      let checkDate = new Date(minDate);
      while (checkDate <= maxDate) {
        const dateKey = Utilities.formatDate(checkDate, 'Europe/Kiev', 'yyyy-MM-dd');
        const rec = resultMapBySegment[segmentName] ? resultMapBySegment[segmentName][dateKey] || { leads: 0, spend: 0 } : { leads: 0, spend: 0 };
        
        if (rec.spend > 0) {
          if (!segmentMinDate) segmentMinDate = new Date(checkDate);
          segmentMaxDate = new Date(checkDate);
        }
        
        checkDate.setDate(checkDate.getDate() + 1);
      }

      if (!segmentMinDate || !segmentMaxDate) return null;

      const segmentDates = [];
      let curDateSeg = new Date(segmentMinDate);
      while (curDateSeg <= segmentMaxDate) {
        segmentDates.push(new Date(curDateSeg));
        curDateSeg.setDate(curDateSeg.getDate() + 1);
      }

      const segmentData = {
        dates: [],
        ratings: [],
        cplDay: [],
        leadsDay: [],
        spendDay: [],
        conversionDay: [],
        maxCPL: [],
        cplCumulative: [],
        cplCumulativeColors: [],
        cplCumulativeArrows: [],
        freq: [],
        ctr: [],
        cpm: [],
        linkClicks: [],
        cpc: [],
        avgWatchTime: [],
        videoName: [],
        siteUrl: [],
        budget: []
      };

      let activeDaysSegment = 0, daysInNormSegment = 0, daysBelowAllowedSegment = 0;
      let segmentLeads = 0, segmentClicks = 0;
      const segmentVideos = new Set(), segmentSites = new Set();
      let aggCostSegment = 0, aggLeadsSegment = 0, prevDayGoodSegment = null;

      for (let i = 0; i < segmentDates.length; i++) {
        const d = segmentDates[i];
        const dateKey = Utilities.formatDate(d, 'Europe/Kiev', 'yyyy-MM-dd');
        const dateDisplay = Utilities.formatDate(d, 'Europe/Kiev', 'dd.MM.yyyy');
        
        segmentData.dates.push(dateDisplay);
        
        const rec = resultMapBySegment[segmentName] ? resultMapBySegment[segmentName][dateKey] || { leads: 0, spend: 0 } : { leads: 0, spend: 0 };
        const dayLeads = rec.leads;
        const daySpend = rec.spend;
        const dayCpl = (dayLeads > 0) ? (daySpend / dayLeads) : 0;

        const fbDataSegment = (dayLeads > 0 || daySpend > 0) ? (fbDataMapBySegment[segmentName] && fbDataMapBySegment[segmentName][dateKey] || {
          freq: [], ctr: [], cpm: [], linkClicks: [],
          cpc: [], avgWatchTime: [], videoName: [], siteUrl: [], budget: []
        }) : {
          freq: [], ctr: [], cpm: [], linkClicks: [],
          cpc: [], avgWatchTime: [], videoName: [], siteUrl: [], budget: []
        };

        if (dayLeads === 0 && daySpend === 0) {
          segmentData.cplDay.push(0);
          segmentData.leadsDay.push(0);
          segmentData.spendDay.push(0);
          segmentData.conversionDay.push('0.00%');
          segmentData.maxCPL.push(displayMaxCPL);
          segmentData.ratings.push('');
          
          segmentData.freq.push('');
          segmentData.ctr.push('');
          segmentData.cpm.push('');
          segmentData.linkClicks.push('');
          segmentData.cpc.push('');
          segmentData.avgWatchTime.push('');
          segmentData.videoName.push('');
          segmentData.siteUrl.push('');
          segmentData.budget.push('');
          
          aggCostSegment = 0;
          aggLeadsSegment = 0;
          segmentData.cplCumulative.push(0);
          segmentData.cplCumulativeColors.push('gray');
          segmentData.cplCumulativeArrows.push('');
          prevDayGoodSegment = null;
          continue;
        }

        let segmentDayConversion = 0;
        if (fbDataSegment.linkClicks && dayLeads > 0) {
          const segmentDayClicks = sumMultilineValues(fbDataSegment.linkClicks);
          if (segmentDayClicks > 0) {
            segmentDayConversion = (dayLeads / segmentDayClicks) * 100;
          }
        }

        segmentData.cplDay.push(dayCpl);
        segmentData.leadsDay.push(dayLeads);
        segmentData.spendDay.push(daySpend);
        segmentData.conversionDay.push(segmentDayConversion.toFixed(2) + '%');
        segmentData.maxCPL.push(displayMaxCPL);
        
        if (dayLeads > 0 || daySpend > 0) activeDaysSegment++;

        segmentData.freq.push(processDayValues(fbDataSegment.freq, 17));
        segmentData.ctr.push(processDayValues(fbDataSegment.ctr, 18));
        segmentData.cpm.push(processDayValues(fbDataSegment.cpm, 19));
        segmentData.linkClicks.push(processDayValues(fbDataSegment.linkClicks, 20));
        segmentData.cpc.push(processDayValues(fbDataSegment.cpc, 21));
        segmentData.avgWatchTime.push(processDayValues(fbDataSegment.avgWatchTime, 22));
        segmentData.videoName.push(processDayValues(fbDataSegment.videoName, 23));
        segmentData.siteUrl.push(processDayValues(fbDataSegment.siteUrl, 24));
        segmentData.budget.push(processDayValues(fbDataSegment.budget, 25));

        if (dayLeads > 0) {
          if (dayCpl <= displayMaxCPL) daysInNormSegment++;
          else daysBelowAllowedSegment++;
        }

        fbDataSegment.videoName?.forEach(video => {
          if (video && video.trim() !== '') {
            segmentVideos.add(video.trim());
          }
        });
        fbDataSegment.siteUrl?.forEach(site => {
          if (site && site.trim() !== '') {
            segmentSites.add(site.trim());
          }
        });

        segmentLeads += dayLeads;
        segmentClicks += sumMultilineValues(fbDataSegment.linkClicks || []);

        let rating;
        if (dayLeads === 0 && daySpend > 0) {
          rating = "D";
        } else {
          rating = calculateRating(dayCpl, maxCPLThreshold);
        }
        segmentData.ratings.push(rating);

        const dayIsGood = (dayLeads > 0 && dayCpl <= displayMaxCPL);
        
        let arrow = '';
        if (prevDayGoodSegment !== null && prevDayGoodSegment !== dayIsGood) {
          if (dayIsGood) {
            arrow = '↗';
          } else {
            arrow = '↘';
          }
        }

        if (prevDayGoodSegment !== null && prevDayGoodSegment !== dayIsGood) {
          aggCostSegment = daySpend;
          aggLeadsSegment = dayLeads;
        } else {
          aggCostSegment += daySpend;
          aggLeadsSegment += dayLeads;
        }

        const finalCpl = (aggLeadsSegment > 0) ? (aggCostSegment / aggLeadsSegment) : 0;
        segmentData.cplCumulative.push(finalCpl);
        
        segmentData.cplCumulativeColors.push(dayIsGood ? 'green' : 'red');
        segmentData.cplCumulativeArrows.push(arrow);
        
        prevDayGoodSegment = dayIsGood;
      }

      const segmentCR = (segmentClicks > 0) ? (segmentLeads / segmentClicks) * 100 : 0;
      
      return {
        data: segmentData,
        metrics: {
          activeDays: activeDaysSegment,
          daysInNorm: daysInNormSegment,
          daysBelowAllowed: daysBelowAllowedSegment,
          cr: segmentCR.toFixed(2).replace('.', ',') + '%',
          videos: segmentVideos.size,
          sites: segmentSites.size
        }
      };
    }

    // Подготовка данных для общей таблицы
    console.log('Building general data...');
    const generalData = {
      dates: [],
      ratings: [],
      cplDay: [],
      leadsDay: [],
      spendDay: [],
      conversionDay: [],
      maxCPL: [],
      cplCumulative: [],
      cplCumulativeColors: [],
      cplCumulativeArrows: [],
      groups: [],
      buyers: [],
      accounts: [],
      freq: [],
      ctr: [],
      cpm: [],
      linkClicks: [],
      cpc: [],
      avgWatchTime: [],
      videoName: [],
      siteUrl: [],
      budget: []
    };

    let activeDays = 0, daysInNorm = 0, daysBelowAllowed = 0;
    let aggCost = 0, aggLeads = 0, prevDayGood = null;

    // Заполнение общих данных
    for (let i = 0; i < allDates.length; i++) {
      const d = allDates[i];
      const dateKey = Utilities.formatDate(d, 'Europe/Kiev', 'yyyy-MM-dd');
      const dateDisplay = Utilities.formatDate(d, 'Europe/Kiev', 'dd.MM.yyyy');
      
      generalData.dates.push(dateDisplay);
      
      const rec = resultMap[dateKey] || { leads: 0, spend: 0 };
      const dayLeads = rec.leads;
      const daySpend = rec.spend;

      if (dayLeads === 0 && daySpend === 0) {
        generalData.cplDay.push(0);
        generalData.leadsDay.push(0);
        generalData.spendDay.push(0);
        generalData.conversionDay.push('0.00%');
        generalData.maxCPL.push(displayMaxCPL);
        generalData.groups.push('');
        generalData.buyers.push('');
        generalData.accounts.push('');
        generalData.ratings.push('');
        
        generalData.freq.push('');
        generalData.ctr.push('');
        generalData.cpm.push('');
        generalData.linkClicks.push('');
        generalData.cpc.push('');
        generalData.avgWatchTime.push('');
        generalData.videoName.push('');
        generalData.siteUrl.push('');
        generalData.budget.push('');
        
        aggCost = 0;
        aggLeads = 0;
        generalData.cplCumulative.push(0);
        generalData.cplCumulativeColors.push('gray');
        generalData.cplCumulativeArrows.push('');
        prevDayGood = null;
        continue;
      }

      const dayCpl = (dayLeads > 0) ? (daySpend / dayLeads) : 0;
      
      let dayConversion = 0;
      if (fbDataMap[dateKey] && fbDataMap[dateKey].linkClicks && dayLeads > 0) {
        const dayClicks = sumMultilineValues(fbDataMap[dateKey].linkClicks);
        if (dayClicks > 0) {
          dayConversion = (dayLeads / dayClicks) * 100;
        }
      }
      
      generalData.cplDay.push(dayCpl);
      generalData.leadsDay.push(dayLeads);
      generalData.spendDay.push(daySpend);
      generalData.conversionDay.push(dayConversion.toFixed(2) + '%');
      generalData.maxCPL.push(displayMaxCPL);

      // Группы
      const dayGroups = groupsByDate[dateKey] || [];
      const uniqueGroups = Array.from(new Set(dayGroups.filter(g => g !== undefined && g !== null && g !== ''))).reverse();
      generalData.groups.push(uniqueGroups.join('\n'));

      // Байеры
      const dayBuyers = buyersByDate[dateKey] || [];
      const uniqueBuyers = Array.from(new Set(dayBuyers.filter(b => b !== undefined && b !== null && b !== ''))).reverse();
      generalData.buyers.push(uniqueBuyers.join('\n'));

      // Аккаунты
      const dayAccounts = accountsByDate[dateKey] || [];
      const uniqueAccounts = Array.from(new Set(dayAccounts.filter(a => a !== undefined && a !== null && a !== ''))).reverse();
      generalData.accounts.push(uniqueAccounts.join('\n'));

      activeDays++;
      if (dayLeads > 0) {
        if (dayCpl <= displayMaxCPL) daysInNorm++;
        else daysBelowAllowed++;
      } else daysBelowAllowed++;

      generalData.freq.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].freq : [], 17));
      generalData.ctr.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].ctr : [], 18));
      generalData.cpm.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].cpm : [], 19));
      generalData.linkClicks.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].linkClicks : [], 20));
      generalData.cpc.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].cpc : [], 21));
      generalData.avgWatchTime.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].avgWatchTime : [], 22));
      generalData.videoName.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].videoName : [], 23));
      generalData.siteUrl.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].siteUrl : [], 24));
      generalData.budget.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].budget : [], 25));

      let rating;
      if (dayLeads === 0 && daySpend > 0) {
        rating = "D";
      } else {
        rating = calculateRating(dayCpl, maxCPLThreshold);
      }
      generalData.ratings.push(rating);

      const dayIsGood = (dayLeads > 0 && dayCpl <= displayMaxCPL);
      
      let arrow = '';
      if (prevDayGood !== null && prevDayGood !== dayIsGood) {
        if (dayIsGood) {
          arrow = '↗';
        } else {
          arrow = '↘';
        }
      }

      if (prevDayGood !== null && prevDayGood !== dayIsGood) {
        aggCost = daySpend;
        aggLeads = dayLeads;
      } else {
        aggCost += daySpend;
        aggLeads += dayLeads;
      }

      const finalCpl = (aggLeads > 0) ? (aggCost / aggLeads) : 0;
      generalData.cplCumulative.push(finalCpl);
      
      generalData.cplCumulativeColors.push(dayIsGood ? 'green' : 'red');
      generalData.cplCumulativeArrows.push(arrow);
      
      prevDayGood = dayIsGood;
    }

    // НОВАЯ СТРУКТУРА: Подготовка данных по Байер -> Группа
    console.log('Processing buyer-group hierarchy data...');
    const buyerGroupsData = {};
    
    // Создаем иерархическую структуру
    Array.from(globalBuyers).forEach(buyerName => {
      buyerGroupsData[buyerName] = {
        buyerData: processSegment(buyerName, resultMapByBuyer, fbDataMapByBuyer, 'buyer'),
        groups: {}
      };
      
      // Для каждого байера находим его группы
      if (buyerGroupsMap[buyerName]) {
        Array.from(buyerGroupsMap[buyerName]).forEach(groupId => {
          const groupName = groupIdToNameMap[groupId];
          if (groupName) {
            const buyerGroupKey = `${buyerName}:::${groupId}`;
            
            // Создаем данные для комбинации байер-группа
            const buyerGroupData = processSegment(buyerGroupKey, resultMapByBuyerGroup, fbDataMapByBuyerGroup, 'buyer-group');
            if (buyerGroupData) {
              buyerGroupsData[buyerName].groups[groupName] = buyerGroupData;
            }
          }
        });
      }
    });

    console.log('Buyer-group hierarchy created with TikTok metrics:', Object.keys(buyerGroupsData).length, 'buyers');

    // Общие метрики
    const crValue = (totalClicksAll > 0) ? (totalLeadsAll / totalClicksAll) * 100 : 0;
    const crStr = crValue.toFixed(2).replace('.', ',') + '%';

    console.log('Analysis completed successfully with enhanced TikTok metrics!');
    console.log('Total unique videos found:', globalVideos.size);

    return {
      article: article,
      generalData: generalData,
      buyerGroupsData: buyerGroupsData, // ДЕРЕВОВИДНАЯ СТРУКТУРА С TIKTOK МЕТРИКАМИ
      generalMetrics: {
        activeDays: activeDays,
        daysInNorm: daysInNorm,
        daysBelowAllowed: daysBelowAllowed,
        totalGroups: globalGroups.size,
        totalBuyers: globalBuyers.size,
        totalAccounts: globalAccounts.size,
        cr: crStr,
        videos: globalVideos.size,
        sites: globalSites.size,
        displayMaxCPL: displayMaxCPL.toFixed(2),
        displayCPL_ROI_minus5: displayCPL_ROI_minus5.toFixed(2),
        groupNames: Array.from(globalGroups).join('\n'),
        buyerNames: Array.from(globalBuyers).join('\n'),
        accountNames: Array.from(globalAccounts).join('\n'),
        videoNames: Array.from(globalVideos).join('\n'),
        siteUrls: Array.from(globalSites).join('\n'),
        status: status,
        season: season,
        category: category,
        stock: stock,
        stockDays: stockDays,
        efficiencyZone: efficiencyZoneFormatted,
        zoneAB: zoneABFormatted,
        zoneAC: zoneACFormatted,
        zoneAD: zoneADFormatted,
        zoneAE: zoneAEFormatted
      }
    };

  } catch (error) {
    console.error('❌ Ошибка в buildChartForArticle:', error);
    
    // Если это уже наша пользовательская ошибка, передаем как есть
    if (error.message.includes('📊') || error.message.includes('🔌') || error.message.includes('🚨') || error.message.includes('🔧')) {
      throw error;
    }
    
    // Для всех остальных ошибок
    throw new Error(`⚠️ Произошла неожиданная ошибка!\n\nТехническая информация:\n${error.message}\n\nРекомендации:\n• Обновите страницу и попробуйте снова\n• Проверьте правильность введенных данных\n• Обратитесь к администратору`);
  }
}
