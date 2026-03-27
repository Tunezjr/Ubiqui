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

function rh(n){
return '0x'+Array.from({length:n},()=>Math.floor(Math.random()*16).toString(16)).join('')
}

function short(a){
return a.slice(0,10)+'...'+a.slice(-6)
}

function simulate(){

const trace=document.getElementById('trace')

if(!FROM){
trace.innerHTML='<div style="color:red;font-size:11px">Connect wallet first.</div>'
return
}

const recipient=document.getElementById('recipient').value.trim()
const amount=parseFloat(document.getElementById('amount').value)

if(!recipient){
trace.innerHTML='<div style="color:red;font-size:11px">Enter recipient address.</div>'
return
}

if(!amount || amount<=0){
trace.innerHTML='<div style="color:red;font-size:11px">Enter valid amount.</div>'
return
}

const btn=document.getElementById('simBtn')

btn.disabled=true
trace.innerHTML=''

const aliasAddr=rh(40)

const steps=[
{
title:'EOA calls shieldedSend()',
detail:`${short(FROM)} → ${short(recipient)}`
},
{
title:'Reserve check',
detail:`Balance remains ${(WALLET_BAL-amount).toLocaleString()} MON`
},
{
title:'CREATE2 alias deployed',
detail:`${aliasAddr}`
},
{
title:'Alias forwards funds',
detail:`${short(aliasAddr)} → ${short(recipient)}`
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
<div class="final-row"><span class="fk">Recipient</span><span class="fv">${short(recipient)}</span></div>
<div class="final-row"><span class="fk">Amount</span><span class="fv">${amount} MON</span></div>`
trace.appendChild(fin)
btn.disabled=false
},steps.length*300+200)
function toggleTheme(){
document.body.classList.toggle("dark")
const SHIELD_CONTRACT = "0xYOUR_CONTRACT_ADDRESS"

const ABI = [
"function shieldedSend(address recipient, uint256 amount) payable"
]

async function sendTransaction(){

const trace = document.getElementById("trace")

if(!signer){
trace.innerHTML='<div style="color:red;font-size:11px">Connect wallet first.</div>'
return
}

const recipient=document.getElementById("recipient").value.trim()
const amount=document.getElementById("amount").value

if(!recipient){
trace.innerHTML='<div style="color:red;font-size:11px">Enter recipient.</div>'
return
}

if(!amount || amount<=0){
trace.innerHTML='<div style="color:red;font-size:11px">Enter valid amount.</div>'
return
}

const btn=document.getElementById("sendBtn")
btn.disabled=true

trace.innerHTML="Submitting transaction..."

try{

const contract=new ethers.Contract(
SHIELD_CONTRACT,
ABI,
signer
)

const tx = await contract.shieldedSend(
recipient,
amountWei
)

trace.innerHTML=`Transaction submitted<br><br>hash: ${tx.hash}<br>waiting for confirmation...`

await tx.wait()

trace.innerHTML=`Transaction confirmed<br><br>tx hash: ${tx.hash}`

}catch(e){

trace.innerHTML="Transaction failed: "+e.message

}

btn.disabled=false
}

}
}