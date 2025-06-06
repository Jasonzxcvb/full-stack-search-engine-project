const express = require("express");
const app = express();
const mc = require("mongodb").MongoClient;
const config = require("./config.js");
const port = 3000;
const fs = require("fs");
const Crawler = require("crawler");
const { Matrix } = require("ml-matrix");
const path = require('path');
// const bodyParser = require('body-parser');
const elasticlunr = require("elasticlunr");
const { ObjectId } = require('mongodb');
const axios = require('axios');

// 134.117.133.32

let crawlerDB;
const fruitsSet = new Set();
const personalSet = new Set();
const fruitsOutgoingLinks = {};
// const fruitsIncomingLinks = {};
const personalOutgoingLinks = {};
// const personalIncomingLinks = {};
let database = "fruits";
let linkCount = 0;
const MAX_LINKS = 1600;

const fruits = elasticlunr(function() {
    this.addField('title');
    this.addField('content');
    this.addField('url');
    this.setRef('_id');
});

const personal = elasticlunr(function() {
    this.addField('title');
    this.addField('content');
    this.addField('url');
    this.setRef('_id');
});

app.use(express.json());

// app.use(bodyParser.urlencoded({ extended: true }));

app.get('/fruits', async (req, res) => {
    // boost is true, search score * pagerank
    // boost is false, only search score

    // request localhost:3000/personal
    if (Object.keys(req.query).length === 0) {
        res.sendFile(path.join(__dirname, 'fruits.html'));
    }else{
        // request localhost:3000/personal?q=wiki&limit=5&boost=true
        let q = req.query.q;
        let boost = req.query.boost;
        let limit = req.query.limit;

        console.log(q, boost, limit);

        let result = await search(q, boost, limit, "fruits");
        result.forEach(item => {
            delete item.link;
        });
        // if(result.length == 0){
        //     res.send("There were no records which met the criteria.");
        // }else{
            res.status(200);
            res.set("Content-Type", "application/json");
            console.log("get fruits");
            res.json(result);
        // }
    }
});

app.get('/personal', async (req, res) => {
    // request localhost:3000/personal
    if (Object.keys(req.query).length === 0) {
        res.sendFile(path.join(__dirname, 'personal.html'));
    }else{
        // request localhost:3000/personal?q=wiki&limit=5&boost=true
        let q = req.query.q;
        let boost = req.query.boost;
        let limit = req.query.limit;

        console.log(q, boost, limit);

        let result = await search(q, boost, limit, "personal");
        result.forEach(item => {
            delete item.link;
        });
        // if(result.length == 0){
        //     res.send("There were no records which met the criteria.");
        // }else{
            res.status(200);
            res.set("Content-Type", "application/json");
            console.log("get personal");
            res.json(result);
        }
        // }
});

app.post('/fruits', async (req, res) => {
    let q = req.body.queryValue;
    let boost = req.body.boostValue;
    let limit = req.body.limitValue;

    console.log(q, boost, limit);

    let result = await search(q, boost, limit, "fruits");

    // if(result.length == 0){
    //     res.send("There were no records which met the criteria.");
    // }else{
        res.status(200);
        res.set("Content-Type", "application/json");
        console.log("post fruits")
        res.json(result);
    // }
    
});

app.post('/personal', async (req, res) => {
    let q = req.body.queryValue;
    let boost = req.body.boostValue;
    let limit = req.body.limitValue;

    console.log(q, boost, limit);

    let result = await search(q, boost, limit, "personal");

    // if(result.length == 0){
    //     res.send("There were no records which met the criteria.");
    // }else{
        res.status(200);
        res.set("Content-Type", "application/json");
        console.log("post personal");
        res.json(result);
    // }
});

app.get('/result', async (req, res) => {
    let db = req.query.db;
    let id = req.query.id;

    let result = await crawlerDB.collection(db).findOne({_id : new ObjectId(id)});

    if (result) {
        const wordFrequency = countWordFrequency(result.text);
        const top10Words = getTopNFrequencies(wordFrequency, 10);

        result.wordFrequency = top10Words;

        res.json(result);

    } else {
        console.log('No document found with the provided criteria.');
    }
});

function getTopNFrequencies(frequencies, n) {
    // Convert the frequencies object into an array and sort by frequency
    const sorted = Object.keys(frequencies)
      .map(key => ({ word: key, frequency: frequencies[key] }))
      .sort((a, b) => b.frequency - a.frequency);
    
    // Take the top n elements
    return sorted.slice(0, n);
}

function countWordFrequency(text) {
    const words = text.match(/\w+/g) || [];
    const frequency = {};
  
    // Iterate over each word
    words.forEach(word => {
      const wordLowerCase = word.toLowerCase();
  
      if (frequency[wordLowerCase]) {
        frequency[wordLowerCase]++;
      } else {
        frequency[wordLowerCase] = 1;
      }
    });
  
    return frequency;
  }

async function NoSearchResult(limit, database){
    let result = await crawlerDB.collection(database).find().toArray();
    // find the limit number of results
    let finalResult = [];
    for(let i=0; i<limit; i++){
        finalResult.push(result[i]);
    }

    finalResult.forEach(item => {
        item.pr = item.pagerank;
        item.name = "Jason Huang, Terry Kong"
        item.score = 0;
        item.link = "http://localhost:3000/result?db="+database+"&id="+item._id;

        delete item._id;
        delete item.text;
        delete item.pagerank;
        delete item.incomingLinks;
        delete item.outgoingLinks;
    });

    return finalResult;
}

async function search(q, boost, limit, database){
    if(boost == undefined){
        boost = "false";
    }
    let searchResult;
    let finalResult;
    if(database == "fruits"){
        if(fruits.search(q, {}).length == 0){
            // res.send("There were no records which met the criteria.");
            let result = await NoSearchResult(limit, database);
            return result;
        }else{
            searchResult = fruits.search(q, {});
        }
    }else{
        if(personal.search(q, {}).length == 0){
            // res.send("There were no records which met the criteria.");
            let result = await NoSearchResult(limit, database);
            return result;
        }else{
            searchResult = personal.search(q, {});
        }
    }

    if(limit > searchResult.length){
        finalResult = await addLimitToSearchResult(searchResult, limit, database);
        limit = finalResult.length;
        // console.log(finalResult);
    }else{
        finalResult = searchResult;
    }

    // console.log(finalResult);
    // console.log(q, typeof(boost), limit, database);

    if(boost.toString() == "true"){
        // pagerank times search score
        let boostResult = await boostCalculate(finalResult, limit, database);
        boostResult.forEach(item => {
            
            item.link = "http://localhost:3000/result?db="+database+"&id="+item._id;
            item.score = item.searchScore;
            item.pr = item.pagerank;
            item.name = "Jason Huang, Terry Kong"

            delete item._id;
            delete item.text;
            delete item.pagerank;
            delete item.searchScore;
            delete item.boostScore;
        });
        // console.log(boostResult);
        return boostResult;
    }else{
        let result = [];
        for(let i=0; i<limit; i++){
            let NoBoostResult = await crawlerDB.collection(database).findOne({_id : {$eq : new ObjectId(finalResult[i].ref)}});
            NoBoostResult.searchScore = finalResult[i].score;
            result.push(NoBoostResult);
        }

        result.forEach(item => {
            
            item.score = item.searchScore;
            item.pr = item.pagerank;
            item.link = "http://localhost:3000/result?db="+database+"&id="+item._id;
            item.name = "Jason Huang, Terry Kong"
            
            delete item._id;
            delete item.text;
            delete item.incomingLinks;
            delete item.outgoingLinks;
            delete item.pagerank;
            delete item.searchScore;
        });

        return result;
    }
}

async function boostCalculate(searchResult, limit, database){
    // find the top "limit" results
    let boostScore = 0;
    let boostResult = [];
    return new Promise(async (resolve, reject) => {
        for (let i = 0; i < searchResult.length; i++) {
            let website = searchResult[i];
            let web = await crawlerDB.collection(database).findOne({_id : {$eq : new ObjectId(website.ref)}});

            delete web.outgoingLinks;
            delete web.incomingLinks;

            web.text = web.text.replace(/\n/g, ' ');

            boostScore = web.pagerank * website.score;
            web.searchScore = website.score;
            web.boostScore = boostScore;
            boostResult.push(web);
        }
        boostResult.sort((a, b) => (a.boostScore < b.boostScore) ? 1 : -1);
        resolve(boostResult.slice(0, limit));
    });
}

async function addLimitToSearchResult(searchResult, limit, database){
    let limitToAddResult = [];
    let databaseResult = await crawlerDB.collection(database).find().toArray();

    databaseResult.forEach(item => {
        let isFound = false;
        searchResult.forEach(element => {
            if(item._id.toString() == element.ref){
                isFound = true;
            }
        });
        if(!isFound){
                let newElement = { ref: item._id.toString(), score: 0};
                limitToAddResult.push(newElement);
        }
    });

    for(let i = 0; i <= limit - searchResult.length; i++){
        searchResult.push(limitToAddResult[i]);
    }

    return searchResult;
}

function populateDB() {
    crawlerDB.collection("fruits").deleteMany({}, function (err, result) {
        if (err) {
            console.error(err);
        } else {
            console.log(`Removed ${result.deletedCount} documents from the "fruits" collection.`);
        }
    });

    crawlerDB.collection("personal").deleteMany({}, function (err, result) {
        if (err) {
            console.error(err);
        } else {
            console.log(`Removed ${result.deletedCount} documents from the "personal" collection.`);
    }
    });
}

mc.connect(config.db.host, function(err, client) {
    if(err) throw err;
        console.log(`We have successfully connected to the ${config.db.name} database.`);
  
        crawlerDB = client.db(config.db.name);
  
        populateDB();

        const c = new Crawler({
            maxConnections: 50,
            callback: function (error, res, done) {
                if (error) {
                    console.log(error);
                    done();
                } else {
                    if (res.headers['content-type'] && !res.headers['content-type'].includes('text/html')) {
                        console.error(`Skipped ${res.request.uri.href}, not an HTML page.`);
                        done();
                        return;
                    }
            
                    if (!res.$) {
                        console.error("Cheerio instance is not available.");
                        done();
                        return;
                    }

                    let $ = res.$;
                    let currentUrl = res.request.uri.href;
                    // let keywordsData = $("meta[name=Keywords]").attr("content");
                    // let descriptionData = $("meta[name=Description]").attr("content");
                    let titleData = $("title").text();
                    let textData = $("p").text();
                    let links = [];
        
                    // console.log("Keywords: " + keywordsData);
                    // console.log("Description: " + descriptionData);
                    // console.log("Title: " + titleData);
        
                    $("a").each(function(i, link){
                        let href = $(link).attr('href');
                        
                        if (href) { // Check if href is defined and not null
                            href = href.replace('./', '');
                    
                            if (!href.startsWith('http')) {
                                href = new URL(href, currentUrl).href; // Convert relative URL to absolute URL
                            }
                    
                            links.push(href);
                        }
                    });
        
                    // Check if the URL exists in the "pages" collection
                    crawlerDB.collection(database).findOne({ url: currentUrl }, function(err, page) {
                        if (err) {
                            console.error(err);
                        } else {
                            if (!page) {
                                // If the page doesn't exist in the collection, create a new document
                                const newPage = {
                                    url: currentUrl,
                                    // keywords: keywordsData,
                                    // description: descriptionData,
                                    title: titleData,
                                    text: textData,
                                    incomingLinks: [],
                                    outgoingLinks: links
                                };
                                // https://en.wikipedia.org/wiki/Main_Page
                                // if(currentUrl)
                                // Insert the new page document into the "pages" collection
                                crawlerDB.collection(database).insertOne(newPage, function(err, result) {
                                    if (err) {
                                        console.error(err);
                                    } else {
                                        // console.log(`Inserted new page: ${currentUrl}`);
                                        if(database == "fruits"){
                                            fruitsSet.add(currentUrl);
                                            if (!fruitsOutgoingLinks[currentUrl]) {
                                                fruitsOutgoingLinks[currentUrl] = [];
                                            }
                                    
                                            $("a").each(function (i, link) {
                                                let href = $(link).attr('href');
                                                href = href.replace('./', '');
                                    
                                                if (!href.startsWith('http')) {
                                                    href = new URL(href, currentUrl).href;
                                                }
                                    
                                                fruitsSet.add(href);
                                                fruitsOutgoingLinks[currentUrl].push(href);
                                    
                                                // if (!fruitsIncomingLinks[href]) {
                                                //     fruitsIncomingLinks[href] = [];
                                                // }
                                                // fruitsIncomingLinks[href].push(currentUrl);
                                            });
                                        }else{
                                            personalSet.add(currentUrl);
                                            if (!personalOutgoingLinks[currentUrl]) {
                                                personalOutgoingLinks[currentUrl] = [];
                                            }
                                    
                                            $("a").each(function (i, link) {
                                                let href = $(link).attr('href');
                                                if (href) {
                                                    href = href.replace('./', '');
                                    
                                                    if (!href.startsWith('http')) {
                                                        href = new URL(href, currentUrl).href;
                                                    }
                                        
                                                    // personalSet.add(href);
                                                    personalOutgoingLinks[currentUrl].push(href);
                                        
                                                    // if (!personalIncomingLinks[href]) {
                                                    //     personalIncomingLinks[href] = [];
                                                    // }
                                                    // personalIncomingLinks[href].push(currentUrl);
                                                }
                                                
                                            });
                                        }
                                    }
        
                                    // Update the incomingLinks for linked pages
                                    links.forEach((link) => {
                                        if (personalSet.has(link)) {
                                            crawlerDB.collection(database).updateOne(
                                                { url: link },
                                                { $addToSet: { incomingLinks: currentUrl } },
                                                function(err, result) {
                                                    if (err) {
                                                        console.error(err);
                                                    }
                                                }
                                            );
                                        }
                                        
                                    });
                                    
        
                                    done(); // Signal that crawling for this page is done
                                });
                            } else {
                                // If the page exists in the collection, update the outgoing links
                                crawlerDB.collection(database).updateOne(
                                    { url: currentUrl },
                                    { $addToSet: { outgoingLinks: { $each: links } } },
                                    function(err, result) {
                                        if (err) {
                                            console.error(err);
                                        }
        
                                        // Update the incomingLinks for linked pages
                                        links.forEach((link) => {
                                            if (personalSet.has(link)) {
                                                crawlerDB.collection(database).updateOne(
                                                    { url: link },
                                                    { $addToSet: { incomingLinks: currentUrl } },
                                                    function(err, result) {
                                                        if (err) {
                                                            console.error(err);
                                                        }
                                                    }
                                                );
                                            }
                                        });
        
                                        done();
                                    }
                                );
                            }
                        }
                    });
        
                    // Enqueue the discovered links for crawling, avoiding duplicates
                    links.forEach((link) => {
                        // Check if the link has already been enqueued
                        if (!visitedUrls.has(link) && linkCount < MAX_LINKS) {
                            visitedUrls.add(link);
                            c.queue(link);
                            linkCount++;  // Increment the counter
                        }
                    });
                }
            }
        });
        // Initialize the set of visited URLs
        const visitedUrls = new Set();

        let isFirstQueueDrained = false;
        c.on('drain',function(){
            if(!isFirstQueueDrained) {
                // Queue the second URL and set the flag to true
                returnPageRank();
                database = "personal";
                c.queue('https://www.goodreads.com/list');
                //c.queue('https://en.wikipedia.org/wiki/Main_Page');
                //c.queue('https://people.scs.carleton.ca/~davidmckenney/fruitgraph/N-0.html');
                isFirstQueueDrained = true;
            } else {
                returnPageRank();
                addElasticlunrData();
                console.log("All crawling done.");
                console.log("Linkcount: "+linkCount);

                axios.put('http://134.117.130.17:3000/searchengines', {
                    request_url: "http://134.117.133.32:3000"
                }, {
                    headers: {
                    'Content-Type': 'application/json'
                    }
                })
                .then(response => {
                    if (response.status === 201) {
                    console.log('Server registered successfully:', response.data);
                    } else {
                    console.log('Server registered with response:', response);
                    }
                })
                .catch(error => {
                    console.error('Server registration failed:', error.response ? error.response.data : error.message);
                });
            }
        });
        
        //Queue a URL, which starts the crawl
        // c.queue('https://people.scs.carleton.ca/~davidmckenney/fruitgraph/N-0.html');
        c.queue('https://people.scs.carleton.ca/~davidmckenney/fruitgraph/N-0.html');
});

app.listen(port, '0.0.0.0', function(){
    console.log(`Server is running on port ${port}`);
});

async function addElasticlunrData() {
    var contentFruits = await crawlerDB.collection("fruits").find({}, { projection: { text: 1, _id: 0 } }).toArray();
    var titleFruits = await crawlerDB.collection("fruits").find({}, { projection: { title: 1, _id: 0 } }).toArray();
    var URLFruits = await crawlerDB.collection("fruits").find({}, { projection: { url: 1, _id: 0 } }).toArray();
    var idFruits = await crawlerDB.collection("fruits").find({}, { projection: {_id: 1} }).toArray();
    var countFruits = await crawlerDB.collection("fruits").countDocuments();
                        
    contentFruits.forEach(item => {
        item.text = item.text.replace(/\n/g, ' ');
    });

    for(let i=0; i<countFruits; i++){
        fruits.addDoc({
            _id: idFruits[i]._id,
            title: titleFruits[i].title,
            content: contentFruits[i].text,
            url: URLFruits[i].url
        });
    }

    var contentPersonal = await crawlerDB.collection("personal").find({}, { projection: { text: 1, _id: 0 } }).toArray();
    var titlePersonal = await crawlerDB.collection("personal").find({}, { projection: { title: 1, _id: 0 } }).toArray();
    var URLPersonal = await crawlerDB.collection("personal").find({}, { projection: { url: 1, _id: 0 } }).toArray();
    var idPersonal = await crawlerDB.collection("personal").find({}, { projection: {_id: 1} }).toArray();
    var countPersonal = await crawlerDB.collection("personal").countDocuments();

    contentPersonal.forEach(item => {
        item.text = item.text.replace(/\n/g, ' ');
    });

    for(let i=0; i<countPersonal; i++){
        personal.addDoc({
            _id: idPersonal[i]._id,
            title: titlePersonal[i].title,
            content: contentPersonal[i].text,
            url: URLPersonal[i].url
        });
    }
}

function returnPageRank() {
    let N;
    if(database == "fruits"){
        N = fruitsSet.size;
    }else{
        N = personalSet.size;
    }
    // console.log(N);
    const d = 0.9; //damping factor

    const P = buildTransitionMatrix(N, d);
    const pageRanks = calculatePageRanks(N, P);

    let rankedLinks;
    if(database == "fruits"){
        rankedLinks = Array.from(fruitsSet).map((link, index) => ({
            link: link,
            score: pageRanks[index]
        }));
    }else{
        rankedLinks = Array.from(personalSet).map((link, index) => ({
            link: link,
            score: pageRanks[index]
        }));
    }
    // console.log(rankedLinks);
    rankedLinks.forEach(linkData => {
        crawlerDB.collection(database).updateOne(
            { url: linkData.link },
            { $set: { pagerank: linkData.score } },
            function(err, result) {
                if (err) {
                    console.error(err);
                } else {
                    // console.log(`Updating pagerank for: ${linkData.link} with score: ${linkData.score}`);
                }
            }
        );
    });

    return;
}

function calculatePageRanks(N, P) {
    let x0 = Matrix.zeros(1, N);
    x0.set(0, 0, 1);
    let lastX;

    // Power iteration with stopping condition
    for (let i = 0; ; i++) {
        lastX = x0.clone();

        x0 = x0.mmul(P);

        let diff = Matrix.sub(x0, lastX);
        let distance = diff.norm();

        if (distance < 0.0001) {
            console.log("Converged!");
            return x0.to2DArray()[0];
        }
    }
}

function buildTransitionMatrix(N, d) {
    let linkArray;
    if(database == "fruits"){
        linkArray = Array.from(fruitsSet);
    }else{
        linkArray = Array.from(personalSet);
    }
    let P = Matrix.zeros(N, N);
    const S = Matrix.ones(N, N).mul(1 / N);

    linkArray.forEach((link, i) => {
        let outgoing;
        if(database == "fruits"){
            outgoing = fruitsOutgoingLinks[link] || [];
        }else{
            outgoing = personalOutgoingLinks[link] || [];
            let outgoingSet = new Set(outgoing);
            outgoingSet = new Set ([...outgoingSet].filter(x => personalSet.has(x)));
            outgoing = Array.from(outgoingSet);
        }
        const probability = 1 / outgoing.length;

        outgoing.forEach(outLink => {
            const j = linkArray.indexOf(outLink);
            if (j !== -1) {
                P.set(i, j, probability);
            }
        });
    });

    P = P.mul(d).add(S.mul(1 - d));

    return P;
}

