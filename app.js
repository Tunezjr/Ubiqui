let FROM=null
let signer=null

const WALLET_BAL=12450
const RESERVE=10

async function connectWallet(){

if(!window.ethereum){
alert("Wallet not detected")
return
}

const provider=new ethers.BrowserProvider(window.ethereum)

await provider.send("eth_requestAccounts",[])

signer=await provider.getSigner()

FROM=await signer.getAddress()

document.getElementById('fromAddr').innerText=FROM
}

function rh(n){return '0x'+Array.from({length:n},()=>Math.floor(Math.random()*16).toString(16)).join('')}
function short(a){return a.slice(0,10)+'...'+a.slice(-6)}

function getRecipient(){
return document.getElementById('toAddr').value.trim()
}

function simulate(){

const trace=document.getElementById('trace')

if(!FROM){
trace.innerHTML='<div style="color:red;font-size:11px">Connect wallet first.</div>'
return
}

const TO=getRecipient()
const amt=parseFloat(document.getElementById('amt').value)||0
const btn=document.getElementById('simBtn')

btn.disabled=true
trace.innerHTML=''

const aliasAddr=rh(40)

const steps=[
{
title:'EOA calls shieldedSend()',
detail:`${short(FROM)} → ${short(TO)}`
},
{
title:'Reserve check',
detail:`Balance remains ${(WALLET_BAL-amt).toLocaleString()} MON`
},
{
title:'CREATE2 alias deployed',
detail:`${aliasAddr}`
},
{
title:'Alias forwards funds',
detail:`${short(aliasAddr)} → ${short(TO)}`
}
]

steps.forEach((s,i)=>{
const el=document.createElement('div')
el.className='step'
el.innerHTML=`<div class="snum">${i+1}</div><div><div class="stitle">${s.title}</div><div class="sdetail">${s.detail}</div></div>`
trace.appendChild(el)
setTimeout(()=>el.classList.add('show'),i*300)
})

setTimeout(()=>{
const fin=document.createElement('div')
fin.className='final show'
fin.innerHTML=`<div class="final-title">Block Explorer View</div>
<div class="final-row"><span class="fk">Sender</span><span class="fv g">${aliasAddr}</span></div>
<div class="final-row"><span class="fk">Recipient</span><span class="fv">${short(TO)}</span></div>
<div class="final-row"><span class="fk">Amount</span><span class="fv">${amt} MON</span></div>`
trace.appendChild(fin)
btn.disabled=false
},steps.length*300+200)

}