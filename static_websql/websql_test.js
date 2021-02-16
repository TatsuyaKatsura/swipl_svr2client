'use strict';

// Simple client for testing WebSQL

const drop_tables = false;  // TODO: change this to false for production

// Encapsulate the database.
// Contains:
//    db: the result from openDatabase(...)
//    tickers:  the Tickers object
//    buy_lots: the BuyLots object
// transaction_executSql: simple way of running a single SQL cmd
// The singleton mykabu_db is after this definition.
class MyKabuDB {
    // The constructor opens the database (and creates it if necessary);
    // you need to create the tables separately.
    constructor() {
        if (window.openDatabase) {
            this.db = openDatabase("mykabu_db",
                                   "0.1", // version
                                   "A database of stock transactions",
                                   5 * 1024 * 1024 // size: 5MB
                                   // No creationCallback
                                  );
            if (! this.db) {
                alert('WebSQL openDatabase error');
            }
        } else {
            alert('WebSQL is not supported by your browser!');
            this.db = undefined;
        }
    }

    create_tables() {
        this.journal = new Journal();
        this.tickers = new Tickers();
        this.buy_lots = new BuyLots();
    }

    // Create and run a transaction with fn(tx) where tx is the transaction
    transaction(fn) {
        this.db.transaction(fn,
                            (err) => this.tx_error_cb(cmd, err));
    }

    // Convenience method: run a single cmd and add a journal entry,
    // all within a single translaction
    transaction_executeSql(cmd, subs, journal_entry) {
        // this.db.transaction(in SQLTransactionCallback callback,
        //                     in optional SQLTransactionErrorCallback errorCallback,
        //                     in optional SQLVoidCallback successCallback)
        // interface SQLVoidCallback { void handleEvent(); }
        // interface SQLTransactionCallback { void handleEvent(in SQLTransaction transaction); }
        // interface SQLTransactionErrorCallback { void handleEvent(in SQLError error); }
        this.transaction(
            (tx) => {
                tx.executeSql(cmd, subs || []);
                if (journal_entry) {
                    mykabu_db.journal.add_tx(tx, journal_entry);
                }
            });
        // if desired, can add a 3rd arg SQLVoidCallback successCallback to transaction
    }

    readTransaction_executeSql(cmd, subs, read_cb) {
        this.db.readTransaction(
            (tx) => tx.executeSql(cmd, subs || [], read_cb),
            (err) => this.tx_error_cb(cmd, err));
    }

    tx_error_cb(cmd, err) {
        // err is of type SQLError: {code, message}
        console.log('WebSQL err:', cmd, err);
        alert('WebSQL err: ' + err.message);
    }
}


var mykabu_db = new MyKabuDB();


// Encapsulate the database table for journalling
class Journal {
    constructor() {
        this.create_table();
    }

    create_table() {
        if (drop_tables) {
            mykabu_db.transaction_executeSql(
                'DROP TABLE IF EXISTS journal');
        }
        mykabu_db.transaction_executeSql(
            'CREATE TABLE IF NOT EXISTS journal (' +
                'id        INTEGER PRIMARY KEY ASC AUTOINCREMENT, ' +
                'timestamp DATETIME, ' +
                'entry     TEXT' +
                ')');
    }

    add_tx(tx, entry) {
        tx.executeSql(
            "INSERT INTO journal(timestamp, entry) VALUES(DATETIME('NOW'),?)",
            [JSON.stringify(entry)]);
    }

    add(entry) {
        mykabu_db.transaction((tx) => this.add_tx(tx, entry));
    }
}

// Encapsulate the database table for tickers
class Tickers {
    constructor() {
        this.create_table();
    }

    create_table() {
        if (drop_tables) {
            mykabu_db.transaction_executeSql(
                'DROP TABLE IF EXISTS tickers');
        }
        mykabu_db.transaction_executeSql(
            'CREATE TABLE IF NOT EXISTS tickers (' +
                'id     INTEGER PRIMARY KEY ASC AUTOINCREMENT, ' +
                'ticker VARYING CHARACTER(40) UNIQUE, ' + // TODO: TEXT ?
                'name   VARYING CHARACTER(255)' +
                ')');
        // implied by UNIQUE in create table: CREATE UNIQUE INDEX index_tickers ON tickers(ticker)
        // In the following, we specify the ID, to ensure that
        // each time we run, the same ticker.id is used; if we
        // don't do this, table buy_lots.ticker_id will be wrong.
        this.insert({id:1, ticker:'GOOG', name:'Alphabet'});
        this.insert({id:2, ticker:'HP',   name:'Hewlett-Packard'});
    }

    insert(row) {
        if (row.id || row.id === 0) { // skip if row.id is null or undefined
            mykabu_db.transaction_executeSql(
                'INSERT OR REPLACE INTO tickers(id, ticker, name) VALUES(?,?, ?)',
                [row.id, row.ticker, row.name],
                {action: 'insert_or_replace',
                 table: 'tickers',
                 data: {id: row.id,
                        ticker: row.ticker,
                        name: row.name}});
        } else {
            mykabu_db.transaction_executeSql(
                    'INSERT OR REPLACE INTO tickers(ticker, name) VALUES(?,?)',
                [row.ticker, row.name],
                {action: 'insert_or_replace',
                 table: 'tickers',
                 data: {ticker: row.ticker,
                        name: row.name}});
        }
    }

    async dump() {
        mykabu_db.readTransaction_executeSql(
            'SELECT id, ticker, name ' +
                'FROM tickers ORDER BY id',
            [],
            (t, data) => this.dump_cb(data))
    }

    async dump_cb() {  // callback from dump()
        if (data) {
            return Array.from(data.rows,
                              (row) => ({id: row.id,
                                        ticker: row.ticker,
                                         name: row.name}));
        } else {
            return [];
        }
    }
}

// Encapsulate the database table for bought lots
class BuyLots {
    constructor() {
        this.create_table();
    }

    create_table() {
        if (drop_tables) {
            mykabu_db.transaction_executeSql(
                'DROP TABLE IF EXISTS buy_lots');
        }
        mykabu_db.transaction_executeSql(
            'CREATE TABLE IF NOT EXISTS buy_lots (' +
                'id              INTEGER PRIMARY KEY ASC AUTOINCREMENT, ' +
                'ticker_id       INTEGER, ' + // tickers.id
                'timestamp       DATETIME, ' +
                'shares          DECIMAL(16,4), ' +
                'price_per_share DECIMAL(16,4), ' +
                'notes           TEXT, ' +
                'broker          VARYING CHARCTER(40)' +
                ')',
            [], null);
    }
}

// Called by <body onload="renderPage();">
async function renderPage() {
    // TODO: create_tables within MyKabuDB.constructor()?
    //       - didn't work when I tried it because of the
    //         order things happened.
    mykabu_db.create_tables();
    document.getElementById('buy_lot').addEventListener('submit', handleBuySubmit);
    show_buy_lots();
}

// Handler for buy form's "submit" button
async function handleBuySubmit(event) {
    event.preventDefault();
    const buy_data = validateBuyData();
    if (buy_data) {
        mykabu_db.readTransaction_executeSql(
            'SELECT id FROM tickers WHERE ticker=?',
            [document.getElementById('buy.ticker').value.trim().toUpperCase()],
            (t, data) => handleBuySubmitTicker(data, buy_data));
    }
}

function validateBuyData() {
    let result = {
        timestamp: document.getElementById('buy.timestamp').value.trim(),
        shares: document.getElementById('buy.shares').value.trim(),
        price_per_share: document.getElementById('buy.price_per_share').value.trim(),
        notes: document.getElementById('buy.notes').value.trim(),
        broker: document.getElementById('buy.broker').value.trim(),
    };
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(result.timestamp)) {
        alert('Invalid date: ' + result.timestamp);
        return null;
    }
    if (!/^\d+(\.\d*)?/.test(result.shares)) {  // TODO: parseNumber
        alert('Invalid # shares: ' + result.shares);
        return null;
    }
    if (!/^\d+(\.\d*)?/.test(result.price_per_share)) {  // TODO: parseNumber
        alert('Invalid # price_per_share: ' + result.price_per_share);
        return null;
    }
    return result;
}

    async function handleBuySubmitTicker(tickers_data, buy_data) {
    if (tickers_data.rows.length) {
        console.assert(tickers_data.rows.length == 1, 'Wrong # rows', tickers_data);
        mykabu_db.transaction_executeSql(
            'INSERT INTO buy_lots(ticker_id,timestamp,shares,price_per_share,notes,broker) ' +
                'VALUES(?,?,?,?,?,?)',
            [tickers_data.rows[0].id,
             buy_data.timestamp,
             buy_data.shares,
             buy_data.price_per_share,
             buy_data.notes,
             buy_data.broker],
            {action: 'insert_or_replace',
             table: 'buy_lots',
             data: buy_data});
    } else {
        alert('Invalid ticker: ' + document.getElementById('buy.ticker').value);
    }
    show_buy_lots();
}

// Display the buy_lots contents
function show_buy_lots() {
    mykabu_db.readTransaction_executeSql(
        'SELECT buy_lots.id,tickers.ticker,' +
               'buy_lots.timestamp,buy_lots.shares,buy_lots.price_per_share,' +
               'buy_lots.notes,buy_lots.broker,' +
               'buy_lots.shares * buy_lots.price_per_share as lot_price ' +
            'FROM buy_lots,tickers ' +
            'WHERE tickers.id = buy_lots.ticker_id ' +
            'ORDER BY buy_lots.timestamp',
        [], // substitute variables for '?'
        (t, data) => show_buy_lots_handler(data));
}

// Callback from SELECT ... from buy_lots that displays the results
function show_buy_lots_handler(data) {
    var table = document.createElement('table');
    if (data.rows.length) {
        var hdr = table.createTHead().insertRow();
        for (const col of Object.keys(data.rows[0])) {
            var c = hdr.insertCell();
            c.innerHTML = '<B>' + sanitizeText(col) + '</B>';
        }
        for (const data_row of data.rows) {
            var row = table.insertRow();
            for (const [name, value] of Object.entries(data_row)) {
                var c = row.insertCell();
                switch (name) {
                case 'shares':
                    c.align = 'right'; // TODO: deprecated
                    c.innerHTML = new Intl.NumberFormat(
                        'en-US',
                        {minimumFractionDigits: 0,
                         maximumFractionDigits: 4}).format(value);
                    break;
                case 'price_per_share':
                case 'lot_price':
                    c.align = 'right'; // TODO: deprecated
                    c.innerHTML = new Intl.NumberFormat(
                        'en-US',
                        {style: 'currency',
                         currency: 'USD',
                         minimumFractionDigits: 2,
                         maximumFractionDigits: 4}).format(value);
                    break;
                case 'notes':
                    c.innerHTML = '<i>' + sanitizeText('' + value) + '</i>';
                    break;
                default: c.innerHTML = sanitizeText(('' + value));
                }
            }
        }
    }
    replaceChildWith('buy_lots', table);
}

// Clear an element
function deleteAllChildren(elem) {
    while (elem.firstChild) {
        elem.firstChild.remove();
    }
}

// Clear an element and replace with a single child
function replaceChildWith(id, new_child) {
    var elem = document.getElementById(id);
    // elem.replaceChild(new_child, elem.firstChild);
    deleteAllChildren(elem);
    elem.appendChild(new_child);
}

// Sanitize a string, allowing tags to not cause problems
function sanitizeText(raw_str) {
    // There shouldn't be a need for .replace(/ /g, '&nbsp;') if CSS
    // has white-space:pre ... but by experiment, it's needed.
    return raw_str ? (raw_str
                      .replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;')
                      .replace(/'/g, '&apos;')
                      .replace(/\n/g, '<br/>')  // TODO: remove - not needed?
                      .replace(/\s/g, '&nbsp;'))  // TODO: add test for tabs in source
        : raw_str;
}

