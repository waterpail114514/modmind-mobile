import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createProjectModelScene } from '../../src/renderer/src/lib/projectModelScene'
export default function ModelCanvas({preview}:{preview:any}) {
  const container=useRef<HTMLDivElement>(null),[error,setError]=useState('')
  useEffect(()=>{
    const host=container.current;if(!host)return
    let alive=true,renderer:THREE.WebGLRenderer|undefined,controls:OrbitControls|undefined,observer:ResizeObserver|undefined,dispose:(()=>void)|undefined,grid:THREE.GridHelper|undefined
    setError('')
    void(async()=>{try{
      const model=await createProjectModelScene(preview);if(!alive){model.dispose();return}dispose=model.dispose
      renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.appendChild(renderer.domElement)
      const scene=new THREE.Scene();scene.add(model.group,new THREE.HemisphereLight(0xffffff,0x506070,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(5,10,8);scene.add(light)
      const bounds=new THREE.Box3().setFromObject(model.group),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),distance=Math.max(16,size.length())
      const camera=new THREE.PerspectiveCamera(40,1,.1,Math.max(10000,distance*20));camera.position.copy(center).add(new THREE.Vector3(distance,distance*.7,distance));controls=new OrbitControls(camera,renderer.domElement);controls.target.copy(center);controls.enableDamping=false
      grid=new THREE.GridHelper(Math.max(32,size.length()*2),16);scene.add(grid)
      const draw=()=>{if(alive&&renderer)renderer.render(scene,camera)};controls.addEventListener('change',draw);controls.update()
      observer=new ResizeObserver(()=>{if(!renderer)return;renderer.setSize(host.clientWidth,host.clientHeight);camera.aspect=host.clientWidth/Math.max(1,host.clientHeight);camera.updateProjectionMatrix();draw()});observer.observe(host)
    }catch(e){if(alive)setError(e instanceof Error?e.message:String(e))}})()
    return()=>{alive=false;observer?.disconnect();controls?.dispose();dispose?.();grid?.geometry.dispose();if(grid){const m=grid.material;Array.isArray(m)?m.forEach(v=>v.dispose()):m.dispose()}renderer?.dispose();renderer?.domElement.remove()}
  },[preview])
  return <div className="model-canvas" ref={container} aria-label="3D 模型预览，可拖动旋转、双指缩放">{error?<p className="inline-error">{error}</p>:null}</div>
}
