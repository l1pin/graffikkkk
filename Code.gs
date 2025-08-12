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
 * УЛУЧШЕННАЯ функция для парсинга названия кампании - точнее извлекает байера
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
        console.log('🔍 Parsing campaign name:', fullName);

        // Ищем артикул в начале (буквы + цифры)
        const articleMatch = fullName.match(/^([A-Z]+\d+)/);
        if (articleMatch) {
            result.article = articleMatch[1];
        }

        // Разделяем по " | "
        const parts = fullName.split(' | ');
        console.log('📝 Campaign parts:', parts);

        if (parts.length >= 2) {
            // ВТОРОЙ элемент - это БАЙЕР (точно!)
            result.buyer = parts[1].trim();
            console.log('👤 Found buyer:', result.buyer);

            if (parts.length >= 3) {
                // Третий элемент содержит источник + аккаунт
                const sourceAccountPart = parts[2].trim();

                // Парсим источник и аккаунт
                // Пример: "TikTok WL1 Akk1.5" -> источник: "TikTok", аккаунт: "WL1"
                const sourceMatch = sourceAccountPart.match(/^(TikTok|Facebook|Instagram|Google)\s*(.*)/i);
                if (sourceMatch) {
                    result.source = sourceMatch[1];
                    const accountPart = sourceMatch[2];

                    // Ищем аккаунт (обычно VL + цифры или WL + цифры)
                    const accountMatch = accountPart.match(/\b(VL\d+|WL\d+|[A-Z]+\d+)\b/);
                    if (accountMatch) {
                        result.account = accountMatch[1];
                    }
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
        console.log('❌ Ошибка парсинга названия кампании:', fullName, e);
    }

    console.log('✅ Parsed campaign info:', result);
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
 * Основная функция для построения аналитики - ИСПРАВЛЕННАЯ связка байеров и метрик
 */
function buildChartForArticle(article, periodStart, periodEnd) {
    console.log('🔥 =================================');
    console.log('🔥 НАЧАЛО ФУНКЦИИ buildChartForArticle');
    console.log('🔥 Артикул:', article);
    console.log('🔥 Период с:', periodStart);
    console.log('🔥 Период до:', periodEnd);
    console.log('🔥 =================================');

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
            console.log('❌ Пустой артикул');
            throw new Error('📝 Артикул не может быть пустым!\n\nВведите корректный артикул для анализа.');
        }

        // Проверяем формат артикула
        article = article.trim().toUpperCase();
        console.log('📝 Обработанный артикул:', article);

        if (article.length < 3) {
            console.log('❌ Слишком короткий артикул:', article);
            throw new Error(`📝 Артикул "${article}" слишком короткий!\n\nАртикул должен содержать минимум 3 символа.`);
        }

        console.log('🚀 Starting analysis for article:', article);

        // Проверяем период
        let periodChosen = false, periodStartDate, periodEndDate;
        if (periodStart && periodEnd) {
            periodChosen = true;
            periodStartDate = new Date(periodStart);
            periodEndDate = new Date(periodEnd);
            console.log('📅 Period selected:', periodStart, 'to', periodEnd);
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
                console.log('📊 Reading data from КАПЫ 3.0 sheet...');
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
                    console.log('✅ Found article in КАПЫ 3.0 at row:', articleRow);
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
                        console.log('🎨 Zone colors from sheet - Background:', zoneBackgroundColor, 'Font:', zoneFontColor);
                    } catch (colorError) {
                        console.log('⚠️ Error reading cell colors:', colorError);
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
                    console.log('⚠️ Article not found in КАПЫ 3.0');
                }
            } else {
                console.log('⚠️ КАПЫ 3.0 sheet not found');
            }
        } catch (e) {
            console.log('❌ Ошибка при получении данных из КАПЫ 3.0:', e);
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
        console.log('🔍 Fetching all data with combined query...');
        console.log('🔍 SQL запрос:', combinedSql);
        let allData;

        try {
            console.log('🔍 Вызываем getDataFromDatabase...');
            allData = getDataFromDatabase(combinedSql);
            console.log('🔍 Результат getDataFromDatabase:', allData ? allData.length : 'null/undefined', 'записей');

            if (!allData || allData.length === 0) {
                console.log('❌ Данные не найдены для артикула:', article);
                throw new Error(`📊 Данные не найдены!\n\nАртикул "${article}" не найден в базе данных.\n\nВозможные причины:\n• Проверьте правильность написания артикула\n• Артикул еще не добавлен в систему\n• Нет активных кампаний за выбранный период`);
            }

            console.log('✅ Данные успешно получены:', allData.length, 'записей');
        } catch (error) {
            console.log('❌ Ошибка при получении данных:', error);
            if (error.message.includes('📊')) {
                throw error; // Перебрасываем наши пользовательские ошибки как есть
            }
            throw new Error(`🔌 Ошибка подключения к базе данных!\n\nТехническая информация: ${error.message}\n\nПопробуйте:\n• Обновить страницу\n• Проверить подключение к интернету\n• Обратиться к администратору`);
        }

        // Парсинг данных
        console.log('📊 Parsing database results...');
        const allRows = parseDbResults(allData);

        console.log('📈 Total rows from database:', allRows.length);

        // СОЗДАЕМ МАППИНГ campaign_name_tracker -> Buyer INFO для связки с TikTok данными
        const campaignToBuyerMap = {}; // campaign_name -> buyer info
        const adGroupToBuyerMap = {}; // adv_group_id -> buyer info

        // Сначала проходим по данным трекера и создаем маппинг
        console.log('🗺️ Creating buyer mapping from tracker data...');
        allRows.forEach(row => {
            const trackerName = String(row.campaign_name_tracker || '').trim();
            const campaignName = String(row.campaign_name || '').trim();
            const groupId = String(row.adv_group_id || '').trim();
            const groupName = String(row.adv_group_name || '').trim();

            if (trackerName && trackerName.includes(article)) {
                const campaignInfo = parseCampaignName(trackerName);
                if (campaignInfo.buyer) {
                    // Создаем маппинг от campaign_name к buyer info
                    if (campaignName) {
                        campaignToBuyerMap[campaignName] = campaignInfo;
                        console.log(`🔗 Mapped campaign "${campaignName}" to buyer "${campaignInfo.buyer}"`);
                    }

                    // Создаем маппинг от adv_group_id к buyer info (с названием группы)
                    if (groupId && groupName) {
                        adGroupToBuyerMap[groupId] = {
                            ...campaignInfo,
                            groupName: groupName
                        };
                        console.log(`🔗 Mapped group_id "${groupId}" (${groupName}) to buyer "${campaignInfo.buyer}"`);
                    }
                }
            }
        });

        console.log('🗺️ Created mappings:');
        console.log('Campaign to buyer map:', Object.keys(campaignToBuyerMap).length, 'entries');
        console.log('Group ID to buyer map:', Object.keys(adGroupToBuyerMap).length, 'entries');

        // СОЗДАЕМ СТРУКТУРЫ ДАННЫХ ДЛЯ ГРУППИРОВКИ
        console.log('🗂️ Processing data structures...');
        let minDate = null, maxDate = null;

        // Общие структуры
        const resultMap = {};
        const fbDataMap = {};

        // По байерам
        const resultMapByBuyer = {};
        const fbDataMapByBuyer = {};

        // По группам объявлений
        const resultMapByGroup = {};
        const fbDataMapByGroup = {};

        // НОВАЯ СТРУКТУРА: Байер → Группа объявлений
        const resultMapByBuyerGroup = {};
        const fbDataMapByBuyerGroup = {};

        // Вспомогательные структуры
        const groupsByDate = {};
        const buyersByDate = {};
        const accountsByDate = {};
        const globalGroups = new Set();
        const globalBuyers = new Set();
        const globalAccounts = new Set();
        const buyerGroupsMap = {}; // { buyer: Set(groups) }
        let totalLeadsAll = 0, totalClicksAll = 0;
        const globalVideos = new Set(), globalSites = new Set();

        // Создаем базовую структуру TikTok метрик
        function createTikTokMetricsObject() {
            return {
                adId: [], freq: [], ctr: [], cpm: [], linkClicks: [],
                cpc: [], avgWatchTime: [], videoName: [], siteUrl: []
            };
        }

        // ОБРАБОТКА ВСЕХ ДАННЫХ СРАЗУ - используя маппинг для связки
        console.log('💰📱 Processing all data with buyer mapping...');
        allRows.forEach(row => {
            const trackerName = String(row.campaign_name_tracker || '').trim();
            const campaignName = String(row.campaign_name || '').trim();
            const groupId = String(row.adv_group_id || '').trim();
            const groupName = String(row.adv_group_name || '').trim();
            const advName = String(row.adv_name || '').trim();
            const targetUrl = String(row.target_url || '').trim();
            const dateObj = new Date(row.adv_date);

            if (isNaN(dateObj.getTime())) return;

            const dateStr = Utilities.formatDate(dateObj, 'Europe/Kiev', 'yyyy-MM-dd');

            // Определяем buyer info - ПРИОРИТЕТ tracker данным
            let buyerInfo = null;
            if (trackerName && trackerName.includes(article)) {
                buyerInfo = parseCampaignName(trackerName);
            } else if (campaignName && campaignToBuyerMap[campaignName]) {
                buyerInfo = campaignToBuyerMap[campaignName];
            } else if (groupId && adGroupToBuyerMap[groupId]) {
                buyerInfo = adGroupToBuyerMap[groupId];
            }

            if (!buyerInfo || buyerInfo.article !== article) return;

            // ДАННЫЕ ЛИДОВ И РАСХОДОВ (из tracker)
            const leads = Number(row.valid) || 0;
            const spend = Number(row.cost) || 0;
            const siteClicks = Number(row.clicks_on_link_tracker) || 0;

            // ДАННЫЕ TIKTOK МЕТРИК (из TikTok)
            const hasMetrics = (campaignName || groupId); // Есть ли TikTok метрики

            if (leads > 0 || spend > 0) {
                console.log(`💰 Processing leads/spend for buyer: ${buyerInfo.buyer}, group: ${groupName}, date: ${dateStr}, leads: ${leads}, spend: ${spend}`);

                // Общие данные
                if (!resultMap[dateStr]) resultMap[dateStr] = { leads: 0, spend: 0 };
                resultMap[dateStr].leads += leads;
                resultMap[dateStr].spend += spend;

                // По байерам
                if (buyerInfo.buyer) {
                    if (!resultMapByBuyer[buyerInfo.buyer]) resultMapByBuyer[buyerInfo.buyer] = {};
                    if (!resultMapByBuyer[buyerInfo.buyer][dateStr]) resultMapByBuyer[buyerInfo.buyer][dateStr] = { leads: 0, spend: 0 };
                    resultMapByBuyer[buyerInfo.buyer][dateStr].leads += leads;
                    resultMapByBuyer[buyerInfo.buyer][dateStr].spend += spend;
                    globalBuyers.add(buyerInfo.buyer);

                    if (!buyersByDate[dateStr]) buyersByDate[dateStr] = [];
                    buyersByDate[dateStr].push(buyerInfo.buyer);
                }

                // По группам объявлений
                if (groupName) {
                    if (!resultMapByGroup[groupName]) resultMapByGroup[groupName] = {};
                    if (!resultMapByGroup[groupName][dateStr]) resultMapByGroup[groupName][dateStr] = { leads: 0, spend: 0 };
                    resultMapByGroup[groupName][dateStr].leads += leads;
                    resultMapByGroup[groupName][dateStr].spend += spend;
                    globalGroups.add(groupName);

                    if (!groupsByDate[dateStr]) groupsByDate[dateStr] = [];
                    groupsByDate[dateStr].push(groupName);
                }

                // НОВАЯ СТРУКТУРА: Байер → Группа объявлений
                if (buyerInfo.buyer && groupName) {
                    const buyerGroupKey = `${buyerInfo.buyer}:::${groupName}`;
                    if (!resultMapByBuyerGroup[buyerGroupKey]) resultMapByBuyerGroup[buyerGroupKey] = {};
                    if (!resultMapByBuyerGroup[buyerGroupKey][dateStr]) resultMapByBuyerGroup[buyerGroupKey][dateStr] = { leads: 0, spend: 0 };
                    resultMapByBuyerGroup[buyerGroupKey][dateStr].leads += leads;
                    resultMapByBuyerGroup[buyerGroupKey][dateStr].spend += spend;

                    // Отслеживаем группы для каждого байера
                    if (!buyerGroupsMap[buyerInfo.buyer]) buyerGroupsMap[buyerInfo.buyer] = new Set();
                    buyerGroupsMap[buyerInfo.buyer].add(groupName);
                }

                totalLeadsAll += leads;
                totalClicksAll += siteClicks;

                if (!minDate || dateObj < minDate) minDate = dateObj;
                if (!maxDate || dateObj > maxDate) maxDate = dateObj;
            }

            // TIKTOK МЕТРИКИ (frequency, CTR, CPM, etc.)
            if (hasMetrics && (campaignName || groupId)) {
                console.log(`📱 Processing TikTok metrics for buyer: ${buyerInfo.buyer}, group: ${groupName}, date: ${dateStr}`);

                // Добавляем метрики в структуру
                function addTikTokMetrics(targetObject, dateKey) {
                    if (!targetObject[dateKey]) {
                        targetObject[dateKey] = createTikTokMetricsObject();
                    }

                    targetObject[dateKey].adId.push(row.adv_id !== undefined && row.adv_id !== null ? String(row.adv_id) : '');
                    targetObject[dateKey].freq.push(row.frequency !== undefined && row.frequency !== null ? String(row.frequency) : '');
                    targetObject[dateKey].ctr.push(row.ctr !== undefined && row.ctr !== null ? String(row.ctr) : '');
                    targetObject[dateKey].cpm.push(row.cpm !== undefined && row.cpm !== null ? String(row.cpm) : '');
                    targetObject[dateKey].linkClicks.push(row.clicks_on_link !== undefined && row.clicks_on_link !== null ? String(row.clicks_on_link) : '');
                    targetObject[dateKey].cpc.push(row.cpc !== undefined && row.cpc !== null ? String(row.cpc) : '');
                    targetObject[dateKey].avgWatchTime.push(row.average_time_on_video !== undefined && row.average_time_on_video !== null ? String(row.average_time_on_video) : '');
                    targetObject[dateKey].videoName.push(advName || '');
                    targetObject[dateKey].siteUrl.push(targetUrl || '');
                }

                // ОБЩИЕ ДАННЫЕ
                addTikTokMetrics(fbDataMap, dateStr);

                // ПО БАЙЕРАМ
                if (buyerInfo.buyer) {
                    if (!fbDataMapByBuyer[buyerInfo.buyer]) fbDataMapByBuyer[buyerInfo.buyer] = {};
                    addTikTokMetrics(fbDataMapByBuyer[buyerInfo.buyer], dateStr);
                }

                // ПО ГРУППАМ ОБЪЯВЛЕНИЙ
                if (groupName) {
                    if (!fbDataMapByGroup[groupName]) fbDataMapByGroup[groupName] = {};
                    addTikTokMetrics(fbDataMapByGroup[groupName], dateStr);
                }

                // БАЙЕР → ГРУППА ОБЪЯВЛЕНИЙ
                if (buyerInfo.buyer && groupName) {
                    const buyerGroupKey = `${buyerInfo.buyer}:::${groupName}`;
                    if (!fbDataMapByBuyerGroup[buyerGroupKey]) fbDataMapByBuyerGroup[buyerGroupKey] = {};
                    addTikTokMetrics(fbDataMapByBuyerGroup[buyerGroupKey], dateStr);
                }

                // Собираем уникальные видео и сайты
                if (advName && advName.trim() !== '') {
                    globalVideos.add(advName.trim());
                }
                if (targetUrl && targetUrl.trim() !== '') {
                    globalSites.add(targetUrl.trim());
                }
            }

            // По аккаунтам
            if (buyerInfo.account) {
                globalAccounts.add(buyerInfo.account);
                if (!accountsByDate[dateStr]) accountsByDate[dateStr] = [];
                accountsByDate[dateStr].push(buyerInfo.account);
            }
        });

        console.log('📊 Data processing completed!');
        console.log('👥 Found buyers:', Array.from(globalBuyers));
        console.log('📁 Found groups:', Array.from(globalGroups));
        console.log('🎬 Found videos:', globalVideos.size);
        console.log('🌐 Found sites:', globalSites.size);
        console.log('🗂️ Buyer groups mapping:', buyerGroupsMap);

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

        // Функция для обработки сегмента
        function processSegment(segmentName, resultMapBySegment, fbDataMapBySegment, segmentType) {
            console.log(`🔄 Processing segment: ${segmentName} (${segmentType})`);

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

            if (!segmentMinDate || !segmentMaxDate) {
                console.log(`⚠️ No active data found for segment: ${segmentName}`);
                return null;
            }

            console.log(`✅ Segment ${segmentName} has data from ${segmentMinDate.toISOString().split('T')[0]} to ${segmentMaxDate.toISOString().split('T')[0]}`);

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
                groups: [],
                freq: [],
                ctr: [],
                cpm: [],
                linkClicks: [],
                cpc: [],
                avgWatchTime: [],
                videoName: [],
                siteUrl: []
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

                const fbDataSegment = (dayLeads > 0 || daySpend > 0) ? (fbDataMapBySegment[segmentName] && fbDataMapBySegment[segmentName][dateKey] || createTikTokMetricsObject()) : createTikTokMetricsObject();

                if (dayLeads === 0 && daySpend === 0) {
                    segmentData.cplDay.push(0);
                    segmentData.leadsDay.push(0);
                    segmentData.spendDay.push(0);
                    segmentData.conversionDay.push('0.00%');
                    segmentData.maxCPL.push(displayMaxCPL);
                    segmentData.ratings.push('');

                    // Группы для байера (даже для нулевых дней)
                    if (segmentType === 'buyer') {
                        segmentData.groups.push('');
                    } else {
                        segmentData.groups.push('');
                    }

                    segmentData.freq.push('');
                    segmentData.ctr.push('');
                    segmentData.cpm.push('');
                    segmentData.linkClicks.push('');
                    segmentData.cpc.push('');
                    segmentData.avgWatchTime.push('');
                    segmentData.videoName.push('');
                    segmentData.siteUrl.push('');

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

                // Группы для байера
                if (segmentType === 'buyer') {
                    const dayGroupsForBuyer = groupsByDate[dateKey] ?
                        groupsByDate[dateKey].filter(group => {
                            const buyerGroups = buyerGroupsMap[segmentName] || new Set();
                            return buyerGroups.has(group);
                        }) : [];
                    const uniqueGroupsForBuyer = Array.from(new Set(dayGroupsForBuyer.filter(g => g !== undefined && g !== null && g !== ''))).reverse();
                    segmentData.groups.push(uniqueGroupsForBuyer.join('\n'));
                } else {
                    segmentData.groups.push('');
                }

                if (dayLeads > 0 || daySpend > 0) activeDaysSegment++;

                segmentData.freq.push(processDayValues(fbDataSegment.freq, 17));
                segmentData.ctr.push(processDayValues(fbDataSegment.ctr, 18));
                segmentData.cpm.push(processDayValues(fbDataSegment.cpm, 19));
                segmentData.linkClicks.push(processDayValues(fbDataSegment.linkClicks, 20));
                segmentData.cpc.push(processDayValues(fbDataSegment.cpc, 21));
                segmentData.avgWatchTime.push(processDayValues(fbDataSegment.avgWatchTime, 22));
                segmentData.videoName.push(processDayValues(fbDataSegment.videoName, 23));
                segmentData.siteUrl.push(processDayValues(fbDataSegment.siteUrl, 24));

                if (dayLeads > 0 && dayCpl <= displayMaxCPL) {
                    daysInNormSegment++;
                } else if (daySpend > 0) {
                    daysBelowAllowedSegment++;
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

            // Группируем даты в диапазоны для сегмента
            const segmentDateRanges = groupDateRanges(segmentData.dates, segmentData.spendDay);

            // Создаем новые массивы с диапазонами для сегмента
            const newSegmentData = {
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
                freq: [],
                ctr: [],
                cpm: [],
                linkClicks: [],
                cpc: [],
                avgWatchTime: [],
                videoName: [],
                siteUrl: [],
                columnSpans: [],
                columnClasses: []
            };

            segmentDateRanges.forEach(range => {
                if (range.isZeroRange && range.startIndex !== range.endIndex) {
                    const rangeLabel = formatDateRange(range.startDate, range.endDate);
                    newSegmentData.dates.push(rangeLabel);
                    newSegmentData.columnSpans.push(range.endIndex - range.startIndex + 1);
                    newSegmentData.columnClasses.push('zero-spend-range');

                    newSegmentData.ratings.push('');
                    newSegmentData.cplDay.push(0);
                    newSegmentData.leadsDay.push(0);
                    newSegmentData.spendDay.push(0);
                    newSegmentData.conversionDay.push('0.00%');
                    newSegmentData.maxCPL.push(segmentData.maxCPL[range.startIndex] || 0);
                    newSegmentData.cplCumulative.push(0);
                    newSegmentData.cplCumulativeColors.push('gray');
                    newSegmentData.cplCumulativeArrows.push('');
                    newSegmentData.groups.push('');
                    newSegmentData.freq.push('');
                    newSegmentData.ctr.push('');
                    newSegmentData.cpm.push('');
                    newSegmentData.linkClicks.push('');
                    newSegmentData.cpc.push('');
                    newSegmentData.avgWatchTime.push('');
                    newSegmentData.videoName.push('');
                    newSegmentData.siteUrl.push('');
                } else {
                    for (let i = range.startIndex; i <= range.endIndex; i++) {
                        newSegmentData.dates.push(segmentData.dates[i]);
                        newSegmentData.columnSpans.push(1);
                        newSegmentData.columnClasses.push(segmentData.spendDay[i] === 0 ? 'zero-spend-single' : 'normal-spend');

                        newSegmentData.ratings.push(segmentData.ratings[i]);
                        newSegmentData.cplDay.push(segmentData.cplDay[i]);
                        newSegmentData.leadsDay.push(segmentData.leadsDay[i]);
                        newSegmentData.spendDay.push(segmentData.spendDay[i]);
                        newSegmentData.conversionDay.push(segmentData.conversionDay[i]);
                        newSegmentData.maxCPL.push(segmentData.maxCPL[i]);
                        newSegmentData.cplCumulative.push(segmentData.cplCumulative[i]);
                        newSegmentData.cplCumulativeColors.push(segmentData.cplCumulativeColors[i]);
                        newSegmentData.cplCumulativeArrows.push(segmentData.cplCumulativeArrows[i]);
                        newSegmentData.groups.push(segmentData.groups[i]);
                        newSegmentData.freq.push(segmentData.freq[i]);
                        newSegmentData.ctr.push(segmentData.ctr[i]);
                        newSegmentData.cpm.push(segmentData.cpm[i]);
                        newSegmentData.linkClicks.push(segmentData.linkClicks[i]);
                        newSegmentData.cpc.push(segmentData.cpc[i]);
                        newSegmentData.avgWatchTime.push(segmentData.avgWatchTime[i]);
                        newSegmentData.videoName.push(segmentData.videoName[i]);
                        newSegmentData.siteUrl.push(segmentData.siteUrl[i]);
                    }
                }
            });

            Object.assign(segmentData, newSegmentData);

            console.log(`✅ Processed segment ${segmentName}: ${activeDaysSegment} active days, ${segmentVideos.size} videos, ${segmentSites.size} sites`);

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

        // Функция для группировки дат в диапазоны
        function groupDateRanges(dates, spends) {
            const ranges = [];
            let currentRange = null;

            for (let i = 0; i < dates.length; i++) {
                const isZeroSpend = spends[i] === 0;

                if (isZeroSpend) {
                    if (!currentRange) {
                        currentRange = {
                            startIndex: i,
                            endIndex: i,
                            startDate: dates[i],
                            endDate: dates[i],
                            isZeroRange: true
                        };
                    } else {
                        currentRange.endIndex = i;
                        currentRange.endDate = dates[i];
                    }
                } else {
                    if (currentRange) {
                        ranges.push(currentRange);
                        currentRange = null;
                    }
                    ranges.push({
                        startIndex: i,
                        endIndex: i,
                        startDate: dates[i],
                        endDate: dates[i],
                        isZeroRange: false
                    });
                }
            }

            if (currentRange) {
                ranges.push(currentRange);
            }

            return ranges;
        }

        // Функция для форматирования диапазона дат
        function formatDateRange(startDate, endDate) {
            if (startDate === endDate) {
                return startDate;
            }

            const startShort = startDate.substring(0, 5);
            const endShort = endDate.substring(0, 5);

            return `${startShort}-${endShort}`;
        }

        // Подготовка данных для общей таблицы
        console.log('📊 Building general data...');
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
            columnSpans: [],
            columnClasses: []
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

            if (dayLeads > 0 || daySpend > 0) activeDays++;

            if (dayLeads > 0 && dayCpl <= displayMaxCPL) {
                daysInNorm++;
            } else if (daySpend > 0) {
                daysBelowAllowed++;
            }

            generalData.freq.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].freq : [], 17));
            generalData.ctr.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].ctr : [], 18));
            generalData.cpm.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].cpm : [], 19));
            generalData.linkClicks.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].linkClicks : [], 20));
            generalData.cpc.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].cpc : [], 21));
            generalData.avgWatchTime.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].avgWatchTime : [], 22));
            generalData.videoName.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].videoName : [], 23));
            generalData.siteUrl.push(processDayValues(fbDataMap[dateKey] ? fbDataMap[dateKey].siteUrl : [], 24));

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

        // Группируем даты в диапазоны
        const dateRanges = groupDateRanges(generalData.dates, generalData.spendDay);

        // Создаем новые массивы с диапазонами
        const newGeneralData = {
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
            columnSpans: [],
            columnClasses: []
        };

        dateRanges.forEach(range => {
            if (range.isZeroRange && range.startIndex !== range.endIndex) {
                const rangeLabel = formatDateRange(range.startDate, range.endDate);
                newGeneralData.dates.push(rangeLabel);
                newGeneralData.columnSpans.push(range.endIndex - range.startIndex + 1);
                newGeneralData.columnClasses.push('zero-spend-range');

                newGeneralData.ratings.push('');
                newGeneralData.cplDay.push(0);
                newGeneralData.leadsDay.push(0);
                newGeneralData.spendDay.push(0);
                newGeneralData.conversionDay.push('0.00%');
                newGeneralData.maxCPL.push(generalData.maxCPL[range.startIndex]);
                newGeneralData.cplCumulative.push(0);
                newGeneralData.cplCumulativeColors.push('gray');
                newGeneralData.cplCumulativeArrows.push('');
                newGeneralData.groups.push('');
                newGeneralData.buyers.push('');
                newGeneralData.accounts.push('');
                newGeneralData.freq.push('');
                newGeneralData.ctr.push('');
                newGeneralData.cpm.push('');
                newGeneralData.linkClicks.push('');
                newGeneralData.cpc.push('');
                newGeneralData.avgWatchTime.push('');
                newGeneralData.videoName.push('');
                newGeneralData.siteUrl.push('');
            } else {
                for (let i = range.startIndex; i <= range.endIndex; i++) {
                    newGeneralData.dates.push(generalData.dates[i]);
                    newGeneralData.columnSpans.push(1);
                    newGeneralData.columnClasses.push(generalData.spendDay[i] === 0 ? 'zero-spend-single' : 'normal-spend');

                    newGeneralData.ratings.push(generalData.ratings[i]);
                    newGeneralData.cplDay.push(generalData.cplDay[i]);
                    newGeneralData.leadsDay.push(generalData.leadsDay[i]);
                    newGeneralData.spendDay.push(generalData.spendDay[i]);
                    newGeneralData.conversionDay.push(generalData.conversionDay[i]);
                    newGeneralData.maxCPL.push(generalData.maxCPL[i]);
                    newGeneralData.cplCumulative.push(generalData.cplCumulative[i]);
                    newGeneralData.cplCumulativeColors.push(generalData.cplCumulativeColors[i]);
                    newGeneralData.cplCumulativeArrows.push(generalData.cplCumulativeArrows[i]);
                    newGeneralData.groups.push(generalData.groups[i]);
                    newGeneralData.buyers.push(generalData.buyers[i]);
                    newGeneralData.accounts.push(generalData.accounts[i]);
                    newGeneralData.freq.push(generalData.freq[i]);
                    newGeneralData.ctr.push(generalData.ctr[i]);
                    newGeneralData.cpm.push(generalData.cpm[i]);
                    newGeneralData.linkClicks.push(generalData.linkClicks[i]);
                    newGeneralData.cpc.push(generalData.cpc[i]);
                    newGeneralData.avgWatchTime.push(generalData.avgWatchTime[i]);
                    newGeneralData.videoName.push(generalData.videoName[i]);
                    newGeneralData.siteUrl.push(generalData.siteUrl[i]);
                }
            }
        });

        Object.assign(generalData, newGeneralData);

        // ИСПРАВЛЕННАЯ СТРУКТУРА: Подготовка данных по Байер → Группа
        console.log('🌲 Processing buyer-group hierarchy data...');
        const buyerGroupsData = {};

        // Создаем иерархическую структуру
        Array.from(globalBuyers).forEach(buyerName => {
            console.log(`👤 Processing buyer: ${buyerName}`);

            buyerGroupsData[buyerName] = {
                buyerData: processSegment(buyerName, resultMapByBuyer, fbDataMapByBuyer, 'buyer'),
                groups: {}
            };

            // Для каждого байера находим его группы
            if (buyerGroupsMap[buyerName]) {
                console.log(`📁 Found ${buyerGroupsMap[buyerName].size} groups for buyer ${buyerName}:`, Array.from(buyerGroupsMap[buyerName]));

                Array.from(buyerGroupsMap[buyerName]).forEach(groupName => {
                    console.log(`📂 Processing group: ${groupName} for buyer: ${buyerName}`);

                    const buyerGroupKey = `${buyerName}:::${groupName}`;

                    // Создаем данные для комбинации байер-группа
                    const buyerGroupData = processSegment(buyerGroupKey, resultMapByBuyerGroup, fbDataMapByBuyerGroup, 'buyer-group');
                    if (buyerGroupData) {
                        buyerGroupsData[buyerName].groups[groupName] = buyerGroupData;
                        console.log(`✅ Added group ${groupName} data for buyer ${buyerName} with ${buyerGroupData.metrics.activeDays} active days`);
                    } else {
                        console.log(`⚠️ No data found for group ${groupName} of buyer ${buyerName}`);
                    }
                });
            } else {
                console.log(`⚠️ No groups found for buyer ${buyerName}`);
            }
        });

        console.log('🌲 Buyer-group hierarchy created:', Object.keys(buyerGroupsData).length, 'buyers');
        console.log('🎯 Final structure overview:');
        Object.keys(buyerGroupsData).forEach(buyer => {
            console.log(`  👤 ${buyer}: ${Object.keys(buyerGroupsData[buyer].groups).length} groups`);
        });

        // Общие метрики
        const crValue = (totalClicksAll > 0) ? (totalLeadsAll / totalClicksAll) * 100 : 0;
        const crStr = crValue.toFixed(2).replace('.', ',') + '%';

        console.log('🎉 Analysis completed successfully!');
        console.log('📊 Total unique videos found:', globalVideos.size);
        console.log('👥 Buyers with groups:', Object.keys(buyerGroupsData));

        const finalResult = {
            article: article,
            generalData: generalData,
            buyerGroupsData: buyerGroupsData, // ИСПРАВЛЕННАЯ ДЕРЕВОВИДНАЯ СТРУКТУРА с полными метриками
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

        console.log('🔥 =================================');
        console.log('🔥 ВОЗВРАЩАЕМ РЕЗУЛЬТАТ');
        console.log('🔥 Артикул:', finalResult.article);
        console.log('🔥 Количество дат:', finalResult.generalData.dates.length);
        console.log('🔥 Количество байеров:', Object.keys(finalResult.buyerGroupsData).length);
        console.log('🔥 =================================');

        return finalResult;

    } catch (error) {
        console.log('🔥 =================================');
        console.log('🔥 ОШИБКА В buildChartForArticle');
        console.log('🔥 Тип ошибки:', typeof error);
        console.log('🔥 Сообщение ошибки:', error.message);
        console.log('🔥 Полная ошибка:', error);
        console.log('🔥 Stack trace:', error.stack);
        console.log('🔥 =================================');

        // Если это уже наша пользовательская ошибка, передаем как есть
        if (error.message && (error.message.includes('📊') || error.message.includes('🔌') || error.message.includes('🚨') || error.message.includes('🔧') || error.message.includes('📝'))) {
            console.log('🔥 Перебрасываем пользовательскую ошибку');
            throw error;
        }

        // Для всех остальных ошибок
        console.log('🔥 Создаем общую ошибку');
        throw new Error(`⚠️ Произошла неожиданная ошибка!\n\nАртикул: ${article}\n\nТехническая информация:\n${error.message}\n\nРекомендации:\n• Обновите страницу и попробуйте снова\n• Проверьте правильность введенных данных\n• Обратитесь к администратору`);
    }
}
