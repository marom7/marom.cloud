        // נתוני משמרות - דוגמהsrc="shifts-common.js"
        let RezervaShiftsDemo = [{
                name: "כהן יצחק",
                employeeNo: "49536",
                role: "בקר - יובל 1",
                pier: "23",
                ship: "ZIM VIETNAM",
                crew: "1",
                company: "1",
                equipmentNo: "4"
            },
            {
                name: "איזנברג יגאל",
                employeeNo: "60125",
                role: "גורר - יובל 1",
                pier: "23",
                ship: "ZIM VIETNAM",
                crew: "1",
                company: "1",
                equipmentNo: "5"
            },
            {
                name: "חמימי סל",
                employeeNo: "60470",
                role: "גורר - יובל 1",
                pier: "23",
                ship: "ZIM VIETNAM",
                crew: "1",
                company: "1",
                equipmentNo: "5"
            },
            {
                name: "משרקי איתי",
                employeeNo: "60512",
                role: "גורר - יובל 1",
                pier: "23",
                ship: "ZIM VIETNAM",
                crew: "1",
                company: "2",
                equipmentNo: "5"
            },
            {
                name: "פרג' יהושע",
                employeeNo: "60476",
                role: "גורר - יובל 1",
                pier: "23",
                ship: "ZIM VIETNAM",
                crew: "1",
                company: "2",
                equipmentNo: "5"
            },
            {
                name: "חננה אור",
                employeeNo: "46953",
                role: "בקר - יובל 1",
                pier: "23",
                ship: "ZIM VIETNAM",
                crew: "2",
                company: "1",
                equipmentNo: "5"
            },
            {
                name: "מגדי סהר",
                employeeNo: "60620",
                role: "גורר - יובל 1",
                pier: "23",
                ship: "ZIM VIETNAM",
                crew: "2",
                company: "2",
                equipmentNo: "5"
            },
            {
                name: "אשכנזי מרדכי",
                employeeNo: "60509",
                role: "גורר - יובל 1",
                pier: "23",
                ship: "ZIM VIETNAM",
                crew: "2",
                company: "1",
                equipmentNo: "5"
            },
            {
                name: "גולן מיכאל מישל",
                employeeNo: "60435",
                role: "גורר - יובל 1",
                pier: "23",
                ship: "ZIM VIETNAM",
                crew: "2",
                company: "1",
                equipmentNo: "5"
            },
            {
                name: "חלווה ג'יא",
                employeeNo: "60576",
                role: "גורר - יובל 1",
                pier: "23",
                ship: "ZIM VIETNAM",
                crew: "2",
                company: "1",
                equipmentNo: "5"
            },
        ];
        
        var MAX_EMPLOYEES_PER_PAGE = 13;
        var isSHETACH_SHONOT =false;
        let pages = [];
        let currentPageIndex = 0;
        let lastHash =null;
        // GET SHIFTS DATA FROM SERVER:
        let allShifts = [];
        loadFromAPI();   
        
        // ******************* GRID DISLAY ******************
        // יצירת עמודים
        function createPages() {
            pages = [];
            let currentPageShifts = [];

            // קיבוץ לפי Pier -> Ship -> Crew  |${shift.crew}
            const grouped = {};
            allShifts.forEach(shift => {
                const groupKey = `|${shift.pier}|${shift.ship}|${shift.company}`;
                if (!grouped[groupKey]) {
                    grouped[groupKey] = {
                        pier: shift.pier, // רציף
                        ship: shift.ship, // אניה
                        company: shift.company, //ספנה
                        crew: (shift.crew.includes('_') ? shift.crew.split('_')[1] : shift.crew)  || shift.crew, // צוות
                        shifts: []
                    };
                }
                grouped[groupKey].shifts.push(shift);
            });

            // המר לרשימה וסדר
            const groupedArray = Object.values(grouped).sort((a, b) => {
                if (a.pier !== b.pier) return a.pier.localeCompare(b.pier, 'he');
                if (a.ship !== b.ship) return a.ship.localeCompare(b.ship, 'he');
                return a.crew.localeCompare(b.crew, 'he');
            });

            // חלק לעמודים
            groupedArray.forEach(group => {
                const groupSize = group.shifts.length;
                const projectedSize = currentPageShifts.reduce((sum, g) => sum + g.shifts.length, 0) + groupSize;
                
                if (isSHETACH_SHONOT)
                    MAX_EMPLOYEES_PER_PAGE= 13;
                if (projectedSize > MAX_EMPLOYEES_PER_PAGE) {
                    // עובר לעמוד חדש
                    if (currentPageShifts.length > 0) {
                        pages.push([...currentPageShifts]);
                        currentPageShifts = [];
                    }
                    // אם הקבוצה עצמה גדולה מדי - שים אותה לבד
                    if (groupSize <= MAX_EMPLOYEES_PER_PAGE) {
                        currentPageShifts.push(group);
                    } else {
                        // כאן השבירה של קבוצה גדולה למקטעים
                        for (let i = 0; i < groupSize; i += MAX_EMPLOYEES_PER_PAGE) {
                            const slice = group.shifts.slice(i, i + MAX_EMPLOYEES_PER_PAGE);
                            pages.push([
                                {
                                    ...group,
                                    shifts: slice
                                }
                            ]);
                        }
                        console.warn(`קבוצה גדולה מדי (ביצוע פיצול) : ${groupSize} עובדים`);
                        // חלק אותה או דלג (תלוי בלוגיקה שלך)
                    }
                } else {
                    currentPageShifts.push(group);
                }
            });
            if (currentPageShifts.length > 0) {
                pages.push(currentPageShifts);
            }

        }

        // הצגת עמוד
        function displayPage(pageIndex) {
            if (pages.length === 0 || pageIndex < 0 || pageIndex >= pages.length) return;

            const tbody = document.getElementById('gridBody');
            tbody.innerHTML = '';

            const pageGroups = pages[pageIndex];

            // מונה צוותים לסירוגין צבעים
            let crewColorIndex = 0;

            pageGroups.forEach(group => {
                const groupSize = group.shifts.length;
                const crewClass = crewColorIndex % 2 === 0 ? 'crew-even' : 'crew-odd';
                crewColorIndex++;

                group.shifts.forEach((shift, shiftIndex) => {
                    const tr = document.createElement('tr');
                    tr.className = crewClass; // הוסף class לסירוגין

                    const isController = shift.role.includes('בקר') || shift.role.includes('אתת') || shift.role.includes('רג')|| shift.role.includes('ראשי')|| shift.role.includes('ר2');

                    // , רציף, אוניה, ספנה ,צוות - רק בשורה הראשונה של הקבוצה
                    if (shiftIndex === 0) {
                        // רציף
                        const tdPier = document.createElement('td');
                        tdPier.className = 'col-pier merged';
                        tdPier.textContent = group.pier;
                        tdPier.rowSpan = groupSize;
                        tr.appendChild(tdPier);
                        // אניה
                        const tdShip = document.createElement('td');
                        tdShip.className = 'col-ship merged';
                        tdShip.textContent = group.ship;
                        tdShip.rowSpan = groupSize;
                        tr.appendChild(tdShip);
                        // ספנה
                        const tdCompany = document.createElement('td');
                        tdCompany.className = 'col-company merged';
                        tdCompany.textContent = group.company;
                        tdCompany.rowSpan = groupSize;
                        tr.appendChild(tdCompany);
                        // צוות
                        const tdCrew = document.createElement('td');
                        tdCrew.className = 'col-crew merged';
                        tdCrew.textContent = group.crew;
                        tdCrew.rowSpan = groupSize;
                        tr.appendChild(tdCrew);
                    }

                    // תפקיד
                    const tdRole = document.createElement('td');
                    tdRole.className = 'col-role';// + (isController ? ' controller' : '');
                    tdRole.textContent = shift.role;
                    tr.appendChild(tdRole);

                    // מספר עובד
                    const tdEmpNo = document.createElement('td');
                    tdEmpNo.className = 'col-empno';// + (isController ? ' controller' : '');
                    tdEmpNo.textContent = shift.employeeNo;
                    tr.appendChild(tdEmpNo);

                    // שם עובד
                    const tdName = document.createElement('td');
                    tdName.className = 'col-name' + (isController ? ' controller' : ''); // רק שם לצבוע בצהוב
                    tdName.textContent = shift.name;
                    tr.appendChild(tdName);

                    // כלי
                    const tdTool = document.createElement('td');
                    tdTool.className = 'col-tool';// + (isController ? ' controller' : '');
                    tdTool.textContent = shift.equipmentNo ;
                    tr.appendChild(tdTool);

                    tbody.appendChild(tr);
                });
            });

            // עדכן מונה עמודים
            document.getElementById('pageNum').textContent = pageIndex + 1;
            document.getElementById('totalPages').textContent = pages.length;
        }
        
        // עדכון תאריך
        function updateDate() {
            const now = new Date();
            const day = String(now.getDate()).padStart(2, '0');
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const year = now.getFullYear();
            //document.getElementById('dateDisplay').textContent = `${day}/${month}/${year}`;
        }

        // מעבר לעמוד הבא
        function nextPage() {
            if (pages.length === 0) return;
            currentPageIndex = (currentPageIndex + 1) % pages.length;
            displayPage(currentPageIndex);
        }
        // ******************* GRID DISLAY end ******************

        // שעון דיגיטלי
        function updateClock() {
            const now = new Date();
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');

            document.getElementById('clockTime').textContent = `${hours}:${minutes}:${seconds}`;
        }

        // COMMAND START SYS.
        // אתחול
        updateDate(); // to fix updateHEADER(date, name, shift)
        updateClock();
        updateWeather();
        createPages();
        displayPage(0);

        // עדכון שעון כל שנייה
        setInterval(updateClock, 1000);

        // עדכון מזג אויר כל 10 דקות
        setInterval(updateWeather, 600000);

        // מעבר אוטומטי של דף כל 14 שניות
        setInterval(nextPage, 14000);

        // עדכון תאריך כל דקה
        //setInterval(updateDate, 60000);

        // רענון נתונים מה-API כל 1.4 דקות
        setInterval(loadFromAPI, 150000);  // 1min + 40 sec
