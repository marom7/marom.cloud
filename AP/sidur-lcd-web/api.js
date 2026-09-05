  // API-טעינה מ
        //########################################################
        // --------- צ.מ [zm] ------------------------------------
        // 1. GetManofiHofGeser *
        // 2. GetSidorMitanKlaly *
        // 3. GetRezifMecholot *
        // 4. GetSetachAndShonot -X4
        // 5. REZERVA 
        // --------- תפעול [tif] ---------------------------------
        // 1. GetSidorTifMitamKlali *
        // 2. GetSidorTifMecholot *
        //########################################################

        async function loadFromAPI() {
            try {
                var wsMethod;
                var shifts = [];
                //var allShifts = [];
                wsMethod = getMethodByParams();
                if (wsMethod != 'GetSetachAndShonot')
                    allShifts = await loadData(wsMethod); // GET DATA TABLE FROM WS for one table
                else
                {   // איחוד כל הטבלאות השייכות לשטח ושונות
                    isSHETACH_SHONOT = true;
                    const ssMethods = ['GetSetachAndShonot', 
                        'GetSetachAndShonotHavrot', 
                        'GetSetachAndShonotMechoniyot', 
                        'GetSharim'];
                    
                     for (i=0; i <= ssMethods.length; i++) {
                        shifts[i] = await loadData(ssMethods[i]);
                        if (shifts[i]){
                            console.log(ssMethods[i], shifts[i]); 
                        }
                        else
                        {
                            shifts[i] =[];
                            console.log(ssMethods[i], 'אין נתונים בטבלה');
                        } 
                    }
                    
                    const combaineShifts = [...shifts[0], ...shifts[1], ...shifts[2], ...shifts[3]]; //shifts[2] = null,
                    allShifts = combaineShifts;
                    console.log('ALL_SHETACH_SHONOT:', combaineShifts); 
                }
                if (wsMethod ==='GetRezerva')
                    allShifts= RezervaShiftsDemo;
                  
                createPages();
                displayPage(currentPageIndex);
            } catch (error) {
                console.error('שגיאה בטעינת נתונים:', error);
            }
        }

        function getMethodByParams() {
            //const urlParams = new URLSearchParams(window.location.search); // פרמטרים משורת הדפדפן
            //var screenId = urlParams.get('screen');
            var id = window.location.hash.slice(1);
            console.log('screen =' + id);
            /* const screenType = JSON.parse(localStorage.getItem('screenViews') || '{}');  // אובייקט המאוחסן בדפדפן
            console.log('LCD1: ', screenType.screen1);
            console.log('LCD2: ', screenType.screen2);
            console.log('DATA NOW:',JSON.stringify(screenType, null, 2));
            console.log('STATUS:',screenType.status);
            console.table(screenType);
            if (screenId==='1') {
                console.log('THIS IS LCD1: ', screenType.screen1);
                screenId = screenType.screen1;
            }
            if (screenId==='2') {
                console.log('THIS IS LCD2: ', screenType.screen2);
                screenId = screenType.screen2;
            } */

            let screenName = '';
            let wsMethod = '';
            switch (id) {
                case 'zm1':
                    screenName = ` מנופאי גשר/חוף `;
                    wsMethod = 'GetManofiHofGeser';
                    break;
                case 'zm2':
                    screenName = ` רציפי מטען כללי 1,3,5,21`;
                    wsMethod = 'GetSidorMitanKlaly';
                    break;
                case 'zm3':
                    screenName = ` רציפי מכולות 7,9,23`;
                    wsMethod = 'GetRezifMecholot';
                    break;
                case 'zm4':
                    screenName = `שטח/שונות `;
                    wsMethod = 'GetSetachAndShonot'; // GET 4 ws_METHODS
                    break;
                case 'zm5':
                    screenName = `רזרבה`;
                    wsMethod = 'GetRezerva'; // TODO
                    break;
                case 'tif1':
                    screenName = ` סידור מטען כללי- סווארים`;
                    wsMethod = 'GetSidorTifMitamKlali';
                    break;
                case 'tif2':
                    screenName = ` סידור מסופי מכולות- סווארים`;
                    wsMethod = 'GetSidorTifMecholot';
                    break;
                default:
                    wsMethod = 'GetManofiHofGeser';
                    break;
            }
            document.getElementById('nameSidurDisplay').textContent = screenName;
            return wsMethod;
        }
        // GET DATA FROM DB    ###################################s
        async function loadData(methodName) {
            //if (methodsName.length === 1)
            try {
                console.log(`🔄 טוען נתונים: ${methodName}  `);
                const wsUrl = '../SidorService.asmx';
                var shifts = [];
                // SOAP Request
                const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
                <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
                            xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
                            xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
                    <soap:Body>
                        <${methodName} xmlns="http://tempuri.org/" />
                    </soap:Body>
                </soap:Envelope>`;

                const response = await fetch(wsUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/xml; charset=utf-8',
                        'SOAPAction': `http://tempuri.org/${methodName}`
                    },
                    body: soapEnvelope
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const xmlText = await response.text();
                console.log('📄 SOAP Response התקבל' + xmlText.length );//,xmlText

                // ✅ השתמש בפונקציה שלך!
                const tableData = renderXmlTable(xmlText);// 'temp-container'

                if (!tableData || tableData.length === 0) {
                    console.log('⚠️ אין נתונים');
                    allShifts = [];
                    this.createPages();
                    this.displayPage(0);
                    return false;
                }

                console.log(`✅ ${tableData.length} שורות נטענו בהצלחה`);
                const dateSidur = tableData[0].DATESIDUR.split('T')[0] || '';
                let MISHMERET = tableData[0].MISHMERET;
                switch (MISHMERET) {
                    case '1':
                        MISHMERET = 'משמרת א';
                        break;
                    case '2':
                        MISHMERET = 'משמרת ב';
                        break;
                    case '3':
                        MISHMERET = 'משמרת ג';
                        break;
                    default:
                        break;
                }
                console.log(`${dateSidur} תאריך :`);
                console.log(`${MISHMERET}`);
                document.getElementById('shiftDisplay').textContent = `${MISHMERET}`;
                document.getElementById('dateDisplay').textContent = `${dateSidur}`;
                // :המר לפורמט שלנו      ---> row.SADRAN  EQUIPMENTNO allShifts =
                shifts = tableData.map(row => ({
                                                pier: row.RAZIF || row.RATZIF || '',
                                                ship: row.ONIYA || '',
                                                company: row.SAFNA || '',
                                                crew: row.TZEVET_KLI || '',
                                                role: (isSHETACH_SHONOT? row.SIBOZ : row.TAFKID) || '',  
                                                name: row.EMPNAME || '',
                                                employeeNo: row.EMPNO || '',
                                                equipmentNo: row.EQUIPMENTNO || ''
                                            }));
            } catch (error) {
                console.error('💥 שגיאה בטעינת נתונים:', error, error.message);
                //this.showError('שגיאה: ' + error.message);
                return false;
            }
            return shifts;
        }
        /* // בדוק שינויים  ℹ️  🔄
        const newHash = calculateHash(allShifts);
        
        if (lastHash !== null && newHash === lastHash) {
            console.log(' אין שינויים בנתונים');
            return false;
        }
        else{
            lastHash = newHash;
            console.log(' זוהה שינוי! מעדכן תצוגה...');

            // עדכן תצוגה
            createPages();
            displayPage(0);
            currentPageIndex = 0;
            //updateLastUpdateTime();
        }
        return true;
        // סנן לפי רציף (אם יש)
         let filteredData = tableData;
                if (this.pierFilter) {
                    filteredData = tableData.filter(row => 
                        row.RATZIF?.toString() === this.pierFilter.toString() ||
                        row.SADRAN?.toString() === this.pierFilter.toString()
                    );
                    console.log(`🔍 אחרי סינון לרציף ${this.pierFilter}: ${filteredData.length} שורות`);
                } 
        */
        function calculateHash(data) {
            const str = JSON.stringify(data);
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            return hash;
        }
        
        function renderXmlTable(xmlString) {  //containerId
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlString, "text/xml");

            // 2. קבל את הטבלה - NewDataSet או diffgram
            let dataContainer = xmlDoc.querySelector("NewDataSet");
            console.log('DATA WS:' ,dataContainer);
            // Fallback: אם לא קיים NewDataSet, נסה diffgram (כמו שהראית!)
            if (!dataContainer) {
                const diffgram = xmlDoc.querySelector("diffgr\\:diffgram, diffgram");
                if (diffgram && diffgram.children.length > 0) {
                    dataContainer = diffgram.children[0]; // ← זה הטבלה!
                } else {
                    dataContainer = innerDoc.documentElement;
                    return null;
                }
            }

            // 3. חלץ את השורות (Table elements)
            const rows = Array.from(dataContainer.children);

            if (rows.length === 0) {
                console.log('⚠️ לא נמצאו שורות');
                return [];
            }

            console.log(`📊 נמצאו ${rows.length} שורות במסד נתונים`);

            // 4. חילוץ כותרות (Headers) באופן אוטומטי מהשורה הראשונה
            const firstRow = rows[0];
            const columns = Array.from(firstRow.children).map(node => node.tagName);

            // 5. המר ל-JavaScript Array (בדיוק כמו שלך!)
            // 6. בניית ה-JSON (לשימוש פנימי או לוגיקה עתידית)
            const tableData = rows.map(row => {
                let rowObj = {};
                columns.forEach(colName => {
                    // מחפש את הערך בתוך התגית המתאימה
                    const cell = row.getElementsByTagName(colName)[0];
                    rowObj[colName] = cell ? cell.textContent : "";
                });
                return rowObj;
            });
            console.log("Parsed JSON Data:", tableData); // להדפסה בקונסול
            return tableData;
        }
        //===================================================
        //########################################################

        // מזג אויר - Open-Meteo API (חינמי!)
        async function updateWeather() {
            try {
                // קואורדינטות של אשדוד
                const lat = 31.8044;
                const lon = 34.6553;

                const response = await fetch(
                    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`
                );

                const data = await response.json();
                const weather = data.current_weather;

                // עדכן טמפרטורה
                document.getElementById('weatherTemp').textContent = Math.round(weather.temperature) + '°C';

                // קוד מזג אויר לאייקון ותיאור
                const weatherCode = weather.weathercode;
                const weatherInfo = getWeatherInfo(weatherCode);

                document.getElementById('weatherIcon').textContent = weatherInfo.icon;
                document.getElementById('weatherDesc').textContent = weatherInfo.desc;

            } catch (error) {
                console.error('שגיאה בטעינת מזג אויר:', error);
                document.getElementById('weatherDesc').textContent = 'לא זמין';
            }
        }

        // מיפוי קודי מזג אויר
        function getWeatherInfo(code) {
            const weatherCodes = {
                0: {
                    icon: '☀️',
                    desc: 'בהיר'
                },
                1: {
                    icon: '🌤️',
                    desc: 'בהיר בעיקר'
                },
                2: {
                    icon: '⛅',
                    desc: 'מעונן חלקית'
                },
                3: {
                    icon: '☁️',
                    desc: 'מעונן'
                },
                45: {
                    icon: '🌫️',
                    desc: 'ערפל'
                },
                48: {
                    icon: '🌫️',
                    desc: 'ערפל קפוא'
                },
                51: {
                    icon: '🌧️',
                    desc: 'טפטוף קל'
                },
                53: {
                    icon: '🌧️',
                    desc: 'טפטוף'
                },
                55: {
                    icon: '🌧️',
                    desc: 'טפטוף חזק'
                },
                56: {
                    icon: '🌨️',
                    desc: 'טפטוף קפוא'
                },
                57: {
                    icon: '🌨️',
                    desc: 'טפטוף קפוא חזק'
                },
                61: {
                    icon: '🌧️',
                    desc: 'גשם קל'
                },
                63: {
                    icon: '🌧️',
                    desc: 'גשם'
                },
                65: {
                    icon: '🌧️',
                    desc: 'גשם חזק'
                },
                66: {
                    icon: '🌨️',
                    desc: 'גשם קפוא'
                },
                67: {
                    icon: '🌨️',
                    desc: 'גשם קפוא חזק'
                },
                71: {
                    icon: '❄️',
                    desc: 'שלג קל'
                },
                73: {
                    icon: '❄️',
                    desc: 'שלג'
                },
                75: {
                    icon: '❄️',
                    desc: 'שלג כבד'
                },
                77: {
                    icon: '🌨️',
                    desc: 'גרגירי שלג'
                },
                80: {
                    icon: '🌦️',
                    desc: 'ממטרים קלים'
                },
                81: {
                    icon: '🌦️',
                    desc: 'ממטרים'
                },
                82: {
                    icon: '🌦️',
                    desc: 'ממטרים חזקים'
                },
                85: {
                    icon: '🌨️',
                    desc: 'שלג קל'
                },
                86: {
                    icon: '🌨️',
                    desc: 'שלג כבד'
                },
                95: {
                    icon: '⛈️',
                    desc: 'סופת רעמים'
                },
                96: {
                    icon: '⛈️',
                    desc: 'סופה עם ברד'
                },
                99: {
                    icon: '⛈️',
                    desc: 'סופה עם ברד כבד'
                }
            };

            return weatherCodes[code] || {
                icon: '🌤️',
                desc: 'לא ידוע'
            };
        }