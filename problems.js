var userHandle=localStorage.userHandle||null

//A helper function to request from the Codeforces API.
async function sha512(string){
    var textBuf=new Uint8Array(Array.from(string).map(a=>a.charCodeAt()))
    console.log(textBuf.buffer)
    var hashBuf=await crypto.subtle.digest("SHA-512",textBuf.buffer)
    var hashArray=new Uint8Array(hashBuf)
    var hex=Array.from(hashArray).map(b=>b.toString(16).padStart(2,"0")).join``
    return hex
}
var apiAuth=null

async function requestAPI(command,options={}){
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
    if(req.readyState=="done"){
        if(req.error)return Promise.reject(error)
        return Promise.resolve(req.result)
    }
    return new Promise((res,rej)=>{
        req.onsuccess=e=>res(req.result)
        req.onerror=e=>rej(req.error)
    })
}

let data={problemset:{},problemData:{}}
let problemIds=[]

var req=indexedDB.open("codeforces",1)
var initDB=false
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
    store.createIndex("list","list")
    initDB=true
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
            lists:[]
        }
    }

    var userStore=trans.objectStore("problems")
    let userData=await waitFor(userStore.getAll())
    for(var i of userData){
        Object.assign(data.problemData[i.contestId+i.index],i)
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
    listProblems()
}

async function refreshProblems(){
    let db=await waitFor(req)

    var resp=await requestAPI("problemset.problems",{})
    console.log(resp)

    var trans=db.transaction("problemset","readwrite")
    var obStore=trans.objectStore("problemset")
    problemIds=resp.problems.map(a=>a.contestId+a.index)
    data.problemset={}
    //data.problemData={}
    for(var i of resp.problems){
        //i.id=[i.contestId,i.index]
        data.problemset[i.contestId+i.index]=i
        if(!data.problemData[i.contestId+i.index]){
            data.problemData[i.contestId+i.index]={
                contestId:i.contestId,
                index:i.index,
                viewTime:null,
                solved:false,
                status:"",
                notes:"",
                lists:[]
            }
        }
    }
    for(var i of resp.problemStatistics){
        data.problemset[i.contestId+i.index].solvedCount=i.solvedCount
    }
    for(var i of resp.problems){
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
    console.log("done loading submissions")
    return subms
}

var curProbId=null
var problemTime=0
function getProblem(){
    let filtered=Object.values(data.problemset).filter(a=>a.rating>=2200&&a.rating<=2600)
    let prob=filtered[Math.random()*filtered.length|0]
    let probEl=document.createElement("a")
    probEl.href="https://codeforces.com/contest/"+prob.contestId+"/problem/"+prob.index
    probEl.target="_blank"
    probEl.append("problem")
    probEl.addEventListener("click",()=>viewProblem(prob.contestId+prob.index))
    document.body.append(probEl)
}

async function viewProblem(probid){
    var problemTime=Date.now()/1000|0

    let db=await waitFor(req)
    let trans=db.transaction("problems","readwrite")
    var obStore=trans.objectStore("problems")
    data.problemData[probid].viewTime=problemTime
    obStore.put(data.problemData[probid])
}

function getProblemStats(contestId,index){
    let numAtts=0
    for(var i of data.submissions){
        if(i.contestId==contestId&&i.problem.index==index){
            numAtts++
        }
    }
}
if(localStorage.apiKey)apiAuth={key:localStorage.apiKey,secret:localStorage.apiSecret}
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
    indexDisp.addEventListener("click",()=>viewProblem(probid))
    var nameDisp=document.createElement("div")
    nameDisp.append(prob.name)
    var ratingDisp=document.createElement("div")
    ratingDisp.append(prob.rating||"unrated")
    contentEl.append(indexDisp,nameDisp,ratingDisp)
    el.append(contentEl)
    el.className="problem"
    el.dataset.problemId=probid
    el.addEventListener("click",function(){
        loadProb(probid)
    })
    if(data.problemData[probid].solved)el.style.backgroundColor="#afa"
    else if(data.problemData[probid].attempted)el.style.backgroundColor="#ffa"
    else if(data.problemData[probid].notes)el.style.backgroundColor="#aaf"
    else if(data.problemData[probid].viewTime)el.style.backgroundColor="#aff"

    return el
}

function listProblems(){
    document.getElementById("problemList").innerHTML=""
    for(let i of problemIds){
        var prEl=genProblemEl(i)
        document.getElementById("problemList").append(prEl)
    }
}
function getTagEl(tag,isUser=false){
    var tagElem=document.createElement("div")
    var lnkElem=document.createElement("div")
    lnkElem.addEventListener("click",a=>{
        if(isUser){
            document.getElementById("searchLists").value=tag
        }else{
            document.getElementById("searchTags").value=tag
        }
        searchProblems()
    })
    Object.assign(tagElem,{
        className:"probTag"
    })
    if(isUser)tagElem.classList.add("userTag")
    lnkElem.append(tag)
    tagElem.appendChild(lnkElem)
    if(isUser){
        var remElem=document.createElement("div")
        Object.assign(remElem,{
            textContent:"\u00a0".repeat(3),
            className:"removeTag"
        })
        remElem.addEventListener("click",a=>{
            removeTag(tag)
        })
        tagElem.appendChild(remElem)
    }
    return tagElem
}

function removeTag(tag){
    data.problemData[curProbId].lists=data.problemData[curProbId].lists.filter(b=>b!=tag)//replace with set later
    updProb(curProbId)
    loadProb(curProbId)
}
//requestAPI("user.friends",{}).then(console.log)
//requestAPI("problemset.problems",{tags:"dfs and similar"}).then(console.log)
function toHMS(secs){
    let toTEl=el=>(""+Math.floor(el)).padStart(2,0)
    return toTEl(secs/3600)+":"+toTEl(secs/60%60)+":"+toTEl(secs%60)
}
function loadProb(pid){
    curProbId=pid
    document.getElementById("probId").textContent=pid
    document.getElementById("probName").textContent=data.problemset[pid].name
    document.getElementById("probStatus").textContent=data.problemData[pid].status??"";
    document.getElementById("probNotes").value=data.problemData[pid].notes
    document.getElementById("probSubmissions").innerHTML=""
    for(var i of data.submissions){
        let submEl=document.createElement("tr")
        let subLink=document.createElement("td")
        subLink.innerHTML=`<a href="https://codeforces.com/contest/${i.contestId}/submission/${i.id}">${i.id}</a>`;
        let verdict=document.createElement("td")
        verdict.append(i.verdict+" "+(i.verdict=="OK"?i.passedTestCount:i.passedTestCount+1))
        let relTimeEl=document.createElement("td")
        relTimeEl.append(i.relativeTimeSeconds==2147483647?"N/A":toHMS(i.relativeTimeSeconds))
        submEl.append(subLink,verdict,relTimeEl)
        if(i.problem.contestId+i.problem.index==curProbId)document.getElementById("probSubmissions").appendChild(submEl)
    }
    var tagsEl=document.getElementById("problemTags")
    tagsEl.innerHTML=""
    if(data.problemData[curProbId].solved){
        for(let i of data.problemset[curProbId].tags){
            tagsEl.append(getTagEl(i))
        }
    }
    for(let i of data.problemData[curProbId].lists){
        tagsEl.append(getTagEl(i,true))
    }
}
async function updProb(pid){
    let db=await waitFor(req)
    let trans=db.transaction("problems","readwrite")
    let os=trans.objectStore("problems")
    let pref=data.problemData[pid]
    pref.notes=document.getElementById("probNotes").value
    os.put(pref)
}
function unviewProb(pid){
    document.getElementById("probId").value=pid
    data.problemData[pid].viewTime=null
}
function searchProblems(){

    document.getElementById("problemList").innerHTML=""
    let titleS=document.getElementById("searchTitle").value
    let titleF=problemIds.filter(a=>{
        if(document.getElementById("searchRegexp").checked){
            return new RegExp(titleS).test(data.problemset[a].name)
        }
        return data.problemset[a].name.toLowerCase().includes(titleS.toLowerCase())
    })
    let indexS=document.getElementById("searchIndex").value
    let indexF=titleF.filter(a=>a.includes(indexS))

    let ratingMin=document.getElementById("searchRatingMin").value
    let ratingMax=document.getElementById("searchRatingMax").value
    let rateSearch=ratingMin!=""||ratingMax!=""
    let sRes=rateSearch?indexF.filter(a=>data.problemset[a].rating>=(+ratingMin||0)&&data.problemset[a].rating<=(+ratingMax||Infinity)):indexF
    let tags=document.getElementById("searchTags").value.split(",")
    if(tags[0]=="")tags=[]
    sRes=sRes.filter(a=>tags.every(b=>data.problemset[a].tags.includes(b)))
    let lists=document.getElementById("searchLists").value.split(",")
    if(lists[0]=="")lists=[]
    sRes=sRes.filter(a=>lists.every(b=>data.problemData[a].lists.includes(b)))
    //console.log(sRes)
    for(let i of sRes){
        document.getElementById("problemList").appendChild(genProblemEl(i))
    }
}
function loadUser(handle){
    userHandle=handle
    let trans=req.result.transaction(["problems","submissions"],"readwrite")
    let probos=trans.objectStore("problems")
    let sos=trans.objectStore("submissions")
    sos.clear()
    for(var i in data.problemData){
        data.problemData[i].solved=false
        data.problemData[i].attempted=false
        probos.put(data.problemData[i])
    }
    trans.oncomplete=e=>{
        console.log("done")
        refreshSubmissions()
    }
}
let tagTypes=["2-sat","binary search","bitmasks","brute force","chinese remainder theorem","combinatorics","constructive algorithms","data structures","dfs and similar","divide and conquer","dp","dsu","expression parsing","fft","flows","games","geometry","graph matchings","graphs","greedy","hashing","implementation","interactive","math","matrices","meet-in-the-middle","number theory","probabilities","schedules","shortest paths","sortings","string suffix structures","strings","ternary search","trees","two pointers"]
document.addEventListener("DOMContentLoaded",()=>{
    console.log("document DOM loaded")
    document.getElementById("addListBtn").addEventListener("click",a=>{
        data.problemData[curProbId].lists.push(document.getElementById("addList").value)
        updProb(curProbId)
        var listsEl=document.getElementById("problemTags")

        listsEl.append(getTagEl(document.getElementById("addList").value,true))
    })
    waitFor(req).then(async ()=>{
        console.log("opened")
        if(initDB){
            console.log("fetching problems")
            await refreshProblems()
        }else{
            console.log("load from DB")
            await loadFromDB()
        }
        listProblems()
    })
})
