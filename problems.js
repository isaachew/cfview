var userHandle="isaachew"

//A helper function to request from the Codeforces API.
async function sha512(string){
    var textBuf=new Uint8Array([...string].map(a=>a.charCodeAt()))
    console.log(textBuf.buffer)
    let hashBuf=await crypto.subtle.digest("SHA-512",textBuf.buffer)
    let hashArray=new Uint8Array(hashBuf)
    let hex=Array.from(hashArray).map(b=>b.toString(16).padStart(2,0)).join``
    return hex
}
var apiAuth=null

async function requestAPI(command,options={}){
    if(options.secret)return
    let orig="https://codeforces.com"
    let url=new URL(orig)
    url.pathname="/api/"+command

    if(apiAuth){
        options.time=Date.now()/1000|0
        options.apiKey=apiAuth.key
    }
    let optionKeys=Object.keys(options).sort()

    for(var opt of optionKeys){
        url.searchParams.append(opt,options[opt])
    }

    if(apiAuth){
        let authParams="?"+optionKeys.map(opt=>opt+"="+options[opt]).join("&")+"#"+apiAuth.secret
        let rand=(Math.random()*16777216|0).toString(16).padStart(6,0)
        console.log(rand)
        let authString=`${rand}/${command}${authParams}`
        url.searchParams.append("apiSig",rand+await sha512(authString))
    }
    console.log("url: ",""+url)
    let result=await fetch(url).then(x=>x.json())
    if(result.status!="OK")throw new Error(result.comment)
    return result.result

}

//Converts an IDBRequest into a promise to be awaited.
function waitFor(req){
    if(req.readyState=="done")return req.result
    return new Promise((res,rej)=>{
        req.onsuccess=e=>res(req.result)
        req.onerror=e=>rej(req.error)
    })
}

let data={}
let problemIds=[]

var req=indexedDB.open("codeforces",1)
req.onupgradeneeded=a=>{
    console.log("creating database")
    var probset=req.result.createObjectStore("problemset",{keyPath:["contestId","index"]})
    probset.createIndex("name","name")
    probset.createIndex("rating","rating")
    probset.createIndex("contest","contestId")
    probset.createIndex("index","index")
    //store.createIndex("type","type")
    probset.createIndex("tags","tags",{multiEntry:true})

    var subms=req.result.createObjectStore("submissions",{keyPath:"id"})
    subms.createIndex("time","creationTimeSeconds")
    subms.createIndex("verdict","verdict")
    subms.createIndex("testset","testset")
    subms.createIndex("tests","passedTestCount")

    var store=req.result.createObjectStore("problems",{keyPath:["contestId","index"]})
    store.createIndex("contest","contestId")
    store.createIndex("index","index")
    store.createIndex("visitTime","visitTime")
    store.createIndex("completionTime","completionTime")
    store.createIndex("attempts","attempts")
    store.createIndex("submissionId","submissionId")
    store.createIndex("status","status")
}
let reverseIndexOrder=false
async function loadFromDB(){
    let db=await waitFor(req)
    var trans=db.transaction(["problemset","problems","submissions"],"readwrite")
    var pbStore=trans.objectStore("problemset")
    let probs=await waitFor(pbStore.getAll())
    probs.forEach((a,b)=>{a.probNum=b})
    probs.sort((a,b)=>(b.contestId-a.contestId)||(reverseIndexOrder?(b.probNum-a.probNum):(a.probNum-b.probNum)))
    probs.forEach((a,b)=>{delete a.probNum})
    problemIds=probs.map(a=>a.contestId+a.index)
    data.problemset={}
    data.problemData={}
    for(var i of probs){
        data.problemset[i.contestId+i.index]=i
        data.problemData[i.contestId+i.index]={
            contestId:i.contestId,
            index:i.index,
            viewTime:null,
            solved:false,
            status:"",
            notes:"",
            tags:[]
        }
    }

    var userStore=trans.objectStore("problems")
    let userData=await waitFor(userStore.getAll())
    for(var i of userData){
        data.problemData[i.contestId+i.index]=i
    }

    var subms=trans.objectStore("submissions")
    data.submissions=await waitFor(subms.getAll())
    processSubmissions(data.submissions)
}

function processSubmissions(subms){
    data.submissions=subms
    for(var i of subms){
        var probId=i.problem.contestId+i.problem.index
        if(data.problemset[probId]){
            data.problemData[probId].attempted=true
            if(i.verdict=="OK")data.problemData[probId].solved=true
        }
    }
}

async function refreshProblems(){
    let db=await waitFor(req)

    var resp=await requestAPI("problemset.problems",{})
    console.log(resp)

    var trans=db.transaction("problemset","readwrite")
    var obStore=trans.objectStore("problemset")

    data.problemset={}
    data.problemData={}
    for(var i of resp.problems){
        //i.id=[i.contestId,i.index]
        data.problemset[i.contestId+i.index]=i
        data.problemData[i.contestId+i.index]={
            contestId:i.contestId,
            index:i.index,
            viewTime:null,
            solved:false,
            status:"",
            notes:"",
            tags:[]
        }
    }
    for(var i of resp.problemStatistics){
        data.problemset[i.contestId+i.index].solvedCount=i.solvedCount
        obStore.put(data.problemset[i.contestId+i.index])
    }
}

async function refreshSubmissions(){
    let subms=await requestAPI("user.status",{handle:userHandle})

    let db=await waitFor(req)
    let trans=db.transaction("submissions","readwrite")

    var obStore=trans.objectStore("submissions")
    for(var i of subms){
        obStore.put(i)
    }
    processSubmissions(subms)
    return subms
}


var problemTime=0
function getProblem(){
    let filtered=Object.values(data.problemset).filter(a=>a.rating>=2300&&a.rating<=2600)
    let prob=filtered[Math.random()*filtered.length|0]
    let probEl=document.createElement("a")
    probEl.href="https://codeforces.com/contest/"+prob.contestId+"/problem/"+prob.index
    probEl.target="_blank"
    probEl.append("problem")
    probEl.addEventListener("click",async a=>{
        problemTime=Date.now()/1000|0
        data.problemset[prob.contestId+prob.index].visitTime=problemTime

        let db=await waitFor(req)
        let trans=db.transaction("problems","readwrite")
        var obStore=trans.objectStore("problems")
        var obj=await waitFor(obStore.get([prob.contestId,prob.index]))
        if(!obj)obj={contestId:prob.contestId,index:prob.index,completionTime:null,attempts:0,submissionId:null,status:"uncompleted"}
        obj.visitTime=problemTime
        obStore.put(obj)
    })
    document.body.append(probEl)
}

function getProblemStats(contestId,index){
    let numAtts=0
    for(var i of data.submissions){
        if(i.contestId==contestId&&i.problem.index==index){
            numAtts++
        }
    }
}
apiAuth={key:"95fd01ab122a112fe03225e64a2082c5accb502b",secret:"735c83074a77281ceb94868ba3ef3da0e0a0a2b1"}
function genProblemEl(probid){
    /*
Display index/link, title, difficulty


    */
    var prob=data.problemset[probid]
    var el=document.createElement("div")
    var contentEl=document.createElement("div")
    contentEl.className="problemDetails"
    var indexDisp=document.createElement("a")
    indexDisp.href="https://codeforces.com/problemset/problem/"+prob.contestId+"/"+prob.index
    indexDisp.target="_blank"
    indexDisp.append(prob.contestId+prob.index)
    var nameDisp=document.createElement("div")
    nameDisp.append(prob.name)
    var ratingDisp=document.createElement("div")
    ratingDisp.append(prob.rating||"unrated")

    var tagsDisp=document.createElement("div")
    tagsDisp.className="problemTags"
    //tagsDisp.append(prob.tags)
    contentEl.append(indexDisp,nameDisp,ratingDisp)
    el.append(contentEl,tagsDisp)
    el.className="problem"
    el.dataset.problemId=probid
    el.addEventListener("click",function(){
        loadProb(probid)
    })
    if(data.problemData[probid].solved)el.style.backgroundColor="#afa"
    else if(data.problemData[probid].notes)el.style.backgroundColor="#aaf"

    return el
}

function listProblems(){
    for(let i of problemIds){
        var prEl=genProblemEl(i)
        document.getElementById("problemList").append(prEl)
    }
}
loadFromDB().then(listProblems)
//requestAPI("user.friends",{}).then(console.log)
//requestAPI("problemset.problems",{tags:"dfs and similar"}).then(console.log)

function loadProb(pid){
    if(pid){
        document.getElementById("probId").value=pid
    }else{
        pid=document.getElementById("probId").value
    }
    document.getElementById("probStatus").textContent=data.problemData[pid].status??""
    document.getElementById("probNotes").value=data.problemData[pid].notes
}
async function updProb(pid){
    if(pid){
        document.getElementById("probId").value=pid
    }else{
        pid=document.getElementById("probId").value
    }
    let db=await waitFor(req)
    let trans=db.transaction("problems","readwrite")
    let os=trans.objectStore("problems")
    let pref=data.problemData[pid]
    pref.notes=document.getElementById("probNotes").value
    os.put(pref)
}
function searchProblems(){

    document.getElementById("problemList").innerHTML=""
    let titleS=document.getElementById("searchTitle").value
    let titleF=problemIds.filter(a=>data.problemset[a].name.toLowerCase().includes(titleS.toLowerCase()))
    let indexS=document.getElementById("searchIndex").value
    let indexF=titleF.filter(a=>a.includes(indexS))

    let ratingMin=document.getElementById("searchRatingMin").value
    let ratingMax=document.getElementById("searchRatingMax").value
    let rateSearch=ratingMin!=""||ratingMax!=""
    let sRes=ratingMin==0?indexF:indexF.filter(a=>data.problemset[a].rating>=(+ratingMin||0)&&data.problemset[a].rating<=(+ratingMax||Infinity))
    //console.log(sRes)
    for(let i of sRes){
        document.getElementById("problemList").appendChild(genProblemEl(i))
    }
}
