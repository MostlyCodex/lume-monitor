import {expect,test} from "@playwright/test";
import {startPreviewServer} from "../dashboard-preview-server.mjs";
let server,origin;
test.beforeAll(async()=>{server=await startPreviewServer(0);origin=`http://127.0.0.1:${server.address().port}`;});
test.afterAll(async()=>{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));});

async function setHidden(page,hidden) {
 await page.evaluate(value=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>value});document.dispatchEvent(new Event("visibilitychange"));},hidden);
}
test("hidden dashboard pauses polling and resumes without duplicate requests or reviving expired authentication",async({page})=>{
 await page.clock.install();
 let requests=0,expired=false;
 page.on("request",request=>{if(request.url().includes("/api/v1/dashboard/"))requests++;});
 await page.route("**/api/v1/dashboard/latest",route=>expired ? route.fulfill({status:401,json:{error:"unauthorized"}}) : route.continue());
 await page.goto(`${origin}/dashboard/`,{waitUntil:"networkidle"});
 await page.locator(".node-card").first().click();
 await expect(page.locator("#detail-content")).toBeVisible();
 await page.waitForLoadState("networkidle");
 await setHidden(page,true);const paused=requests;
 await page.clock.fastForward(6*60_000);expect(requests).toBe(paused);
 const latest=page.waitForResponse(response=>response.url().endsWith("/dashboard/latest"));
 await setHidden(page,false);await latest;
 await page.waitForLoadState("networkidle");expect(requests-paused).toBe(3);
 const fresh=requests;
 await setHidden(page,true);
 await page.clock.fastForward(1000);
 const refresh=page.waitForResponse(response=>response.url().endsWith("/dashboard/latest"));
 await setHidden(page,false);await refresh;
 await page.waitForLoadState("networkidle");expect(requests-fresh).toBe(1);
 expired=true;
 await setHidden(page,true);await setHidden(page,false);
 await expect(page.locator("#auth-view")).toBeVisible();const signedOut=requests;
 await setHidden(page,true);await setHidden(page,false);await page.clock.fastForward(6*60_000);
 expect(requests).toBe(signedOut);
});

test("cycle totals reuse the traffic row without hover text and the facts list the interfaces",async({page},testInfo)=>{
 await page.route("**/api/v1/dashboard/latest",async route=>{
  const response=await route.fetch();const data=await response.json();const node=data.nodes[0];
  Object.assign(node.metrics,{network_valid:true,network_interfaces:["eth0","ens192"],traffic_cycle:{rx_bytes:1073741824,tx_bytes:2147483648}});
  await route.fulfill({response,json:data});
 });
 await page.goto(`${origin}/dashboard/`,{waitUntil:"networkidle"});
 const card=page.locator(".node-card").first();
 await expect(card.locator(".node-network-row")).toHaveCount(2);
 const traffic=card.locator(".node-network-row").nth(1);
 await expect(traffic).toContainText("周期流量");await expect(traffic).toContainText("↑ 2.00 GB");await expect(traffic).toContainText("↓ 1.00 GB");
 await expect(traffic).not.toHaveAttribute("title",/./);
 await card.click();
 const facts=page.locator("#detail-facts");await expect(facts).toContainText("eth0、ens192");await expect(facts).not.toContainText("流量周期");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 const overflow=await facts.locator("dd").evaluateAll(values=>values.some(value=>value.scrollWidth>value.clientWidth+1));expect(overflow).toBe(false);
 await testInfo.attach("traffic-cycle-facts",{body:await facts.screenshot(),contentType:"image/png"});
});

test("unavailable interface measurements remain unknown instead of displaying zero traffic",async({page})=>{
 await page.route("**/api/v1/dashboard/latest",async route=>{
  const response=await route.fetch();const data=await response.json();Object.assign(data.nodes[0].metrics,{network_valid:false,network_interfaces:[],network_rx_rate_bps:null,network_tx_rate_bps:null});await route.fulfill({response,json:data});
 });
 await page.goto(`${origin}/dashboard/`,{waitUntil:"networkidle"});const card=page.locator(".node-card").first();
 await expect(card.locator(".node-network-row").nth(1)).toContainText("↑ —");await card.click();await expect(page.locator("#detail-facts")).toContainText("无法识别，请配置网卡");
});

test("a node without a reported cycle shows unknown traffic",async({page})=>{
 await page.route("**/api/v1/dashboard/latest",async route=>{
  const response=await route.fetch();const data=await response.json();Object.assign(data.nodes[0].metrics,{network_valid:true,network_interfaces:["eth0"],traffic_cycle:null});await route.fulfill({response,json:data});
 });
 await page.goto(`${origin}/dashboard/`,{waitUntil:"networkidle"});const card=page.locator(".node-card").first();
 await expect(card.locator(".node-network-row").nth(1)).toContainText("周期流量");await expect(card.locator(".node-network-row").nth(1)).toContainText("↑ —");
});
