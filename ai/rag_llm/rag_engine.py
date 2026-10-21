"""
SportsAI+ — RAG-LLM Coaching & Nutrition Engine
TF-IDF retrieval over 10 knowledge base documents.
Novel: first system linking biomechanics errors to country-specific nutrition.
"""
import math, re
from pathlib import Path
from typing import List, Dict, Optional
from collections import defaultdict

KB_DIR = Path(__file__).parent / "knowledge_base"
NUTRITION_KB_DIR = Path(__file__).resolve().parents[2] / "frontend" / "src" / "data" / "nutrition"
SUPPORTED = ["india","usa","japan"]

ERROR_QUERIES = {
    "cadence_low":      "low cadence overstriding heel strike drills turnover",
    "gct_high":         "ground contact time ankle stiffness reactive strength",
    "symmetry_low":     "asymmetry hip weakness single leg balance drills",
    "torso_lean_high":  "forward lean lumbar spine core stability posture",
    "efficiency_low":   "running economy improvement strides tempo",
    "foot_strike_heel": "heel strike midfoot forefoot transition landing",
    "stride_short":     "stride length hip flexor glute activation",
}
NUTRITION_QUERIES = {
    "recovery":         "protein timing muscle recovery post run",
    "tendon":           "collagen tendon joint support runner",
    "anti_inf":         "anti inflammatory foods recovery",
    "energy":           "carbohydrate energy glycogen",
    "hydration":        "electrolyte hydration runner",
}


class TFIDFRetriever:
    def __init__(self):
        self._docs: List[Dict] = []
        self._tf:   List[Dict] = []
        self._idf:  Dict[str,float] = {}
        self._built = False

    def _tokenize(self, text):
        return re.findall(r"[a-zA-Z]{3,}", text.lower())

    def build(self, documents):
        self._docs = documents
        df = defaultdict(int)
        tf_list = []
        for doc in documents:
            tokens = self._tokenize(doc["text"])
            freq   = defaultdict(int)
            for t in tokens: freq[t] += 1
            total = max(len(tokens),1)
            tf = {t: c/total for t,c in freq.items()}
            tf_list.append(tf)
            for t in tf: df[t] += 1
        N = len(documents)
        self._idf = {t: math.log((N+1)/(c+1))+1 for t,c in df.items()}
        self._tf = tf_list
        self._built = True

    def _vec(self, tf):
        return {t: tf[t]*self._idf.get(t,0) for t in tf}

    def _cosine(self, a, b):
        keys = set(a)&set(b)
        if not keys: return 0.0
        dot = sum(a[k]*b[k] for k in keys)
        na  = math.sqrt(sum(v*v for v in a.values()))+1e-8
        nb  = math.sqrt(sum(v*v for v in b.values()))+1e-8
        return dot/(na*nb)

    def retrieve(self, query, n_results=4, category=None):
        if not self._built: return []
        qtf = defaultdict(int)
        for t in self._tokenize(query): qtf[t] += 1
        total = max(sum(qtf.values()),1)
        qnorm = {t: c/total for t,c in qtf.items()}
        qvec  = self._vec(qnorm)
        scores = []
        for i,(doc,tf) in enumerate(zip(self._docs,self._tf)):
            if category and doc.get("category")!=category: continue
            scores.append((self._cosine(qvec,self._vec(tf)), i))
        scores.sort(reverse=True)
        return [{"text":self._docs[i]["text"],"source":self._docs[i]["source"],
                 "category":self._docs[i]["category"],"relevance":round(s,4)}
                for s,i in scores[:n_results]]


def load_kb(country):
    country = country.lower()
    if country not in SUPPORTED: country = "india"
    docs = []
    def chunk(text, size=300, overlap=50):
        words = text.split(); out, i = [], 0
        while i<len(words):
            out.append(" ".join(words[i:i+size])); i+=size-overlap
        return out or [text]

    for cat in ["biomechanics","drills"]:
        p = KB_DIR/cat
        if not p.exists(): continue
        for f in p.glob("*.txt"):
            content = f.read_text(encoding="utf-8")
            for idx,c in enumerate(chunk(content)):
                docs.append({"text":c,"source":f.name,"category":cat,"id":f"{cat}_{f.stem}_{idx}"})

    # The browser chat and this Python prototype share one source corpus.
    nut_paths = [NUTRITION_KB_DIR/"common", NUTRITION_KB_DIR/country]
    for nut_path in nut_paths:
        if not nut_path.exists(): continue
        for f in nut_path.glob("*.txt"):
            content = f.read_text(encoding="utf-8")
            for idx,c in enumerate(chunk(content)):
                docs.append({"text":c,"source":f.name,"category":"nutrition","id":f"nut_{country}_{f.stem}_{idx}"})
    return docs


class TemplateLLM:
    def generate(self, data):
        m, mki, errors, country = data["metrics"], data["mki"], data["errors"], data["country"]
        return {
            "coaching_cue":   self._cue(m, mki),
            "drill_plan":     self._drills(m),
            "nutrition_plan": self._nutrition(m, country),
            "injury_risk":    self._risk(m),
            "country":        country,
        }

    def _cue(self, m, mki):
        score = mki.get("mki_score",0); grade = mki.get("grade","Poor")
        parts = []
        if score>=80: parts.append(f"Excellent form — MKI {score:.1f}/100 ({grade}). Focus on maintaining mechanics and progressive loading.")
        elif score>=60: parts.append(f"MKI {score:.1f}/100 ({grade}) — clear improvement potential. Address priorities below over 4-6 weeks.")
        else: parts.append(f"MKI {score:.1f}/100 ({grade}) — technique needs priority before adding intensity.")
        cad = m.get("cadence",170)
        if cad<160: parts.append(f"Cadence {cad:.0f} spm is significantly below optimal (170-180). Use 175 BPM metronome on next easy run — light quick steps, not bigger strides.")
        elif cad<170: parts.append(f"Cadence {cad:.0f} spm slightly low. Increase by 5-10 spm over 2 weeks with A-Skip drills.")
        gct = m.get("ground_contact_time",0.25)
        if gct>0.30: parts.append(f"Ground contact time {gct:.3f}s is high (target <0.25s). Add ankle hops 3 sets of 20 reps, 3x weekly.")
        sym = m.get("symmetry",95)
        if sym<85: parts.append(f"Symmetry {sym:.1f}% shows significant imbalance — injury risk elevated. Prioritise single-leg strength work.")
        elif sym<95: parts.append(f"Symmetry {sym:.1f}% shows minor imbalance. Clamshells and single-leg deadlifts will address this.")
        if m.get("foot_strike","Midfoot")=="Heel": parts.append("Heel striking detected. Focus on landing with foot under centre of mass using wall drills and A-skips.")
        return " ".join(parts)

    def _drills(self, m):
        drills = []
        if m.get("cadence",170)<170:
            drills += [
                {"name":"A-Skip","sets_reps":"4×20m","cue":"Drive knee to hip, spring off ball of foot","frequency":"3×/week","target":"Cadence to 170-180 spm"},
                {"name":"Fast Feet","sets_reps":"3×15s","cue":"Quick light steps, pretend ground is hot, 190+ spm","frequency":"Daily warm-up","target":"Neuromuscular quickness"},
                {"name":"Metronome Run","sets_reps":"10 min easy","cue":"Match footfalls to 175 BPM beat","frequency":"2×/week","target":"Cadence habituation"},
            ]
        if m.get("ground_contact_time",0.25)>0.25:
            drills += [
                {"name":"Ankle Hops","sets_reps":"3×20 reps","cue":"Stiff ankle, minimal knee bend, spring rapidly","frequency":"3×/week","target":"GCT below 0.25s"},
                {"name":"Pogo Jumps","sets_reps":"3×15 reps","cue":"Both feet, stiff ankles, rapid contact","frequency":"2×/week","target":"Reactive strength"},
            ]
        if m.get("symmetry",95)<95:
            drills += [
                {"name":"Single-Leg Deadlift","sets_reps":"3×10 each","cue":"Hip hinge on one leg, back flat, reach opposite hand","frequency":"2×/week","target":"Strength symmetry"},
                {"name":"Clamshells with Band","sets_reps":"3×15 each","cue":"Rotate top knee, control return","frequency":"3×/week","target":"Hip abductor strength"},
                {"name":"Single-Leg Balance","sets_reps":"3×30s each","cue":"Stand tall, pelvis level, progress eyes closed","frequency":"Daily","target":"Proprioception"},
            ]
        if m.get("foot_strike","Midfoot")=="Heel":
            drills.append({"name":"Wall Drill","sets_reps":"3×10 each","cue":"45-degree lean, drive knee up, pull toes up","frequency":"Daily","target":"Midfoot landing"})
        if not drills:
            drills.append({"name":"Relaxed Strides","sets_reps":"6×100m at 95%","cue":"Relaxed and fast, full recovery","frequency":"2×/week","target":"Running economy"})
        return drills

    def _nutrition(self, m, country):
        cn = self._country_data(country)
        gct = m.get("ground_contact_time",0.25); sym = m.get("symmetry",95)
        tp  = None
        if gct>0.28 or sym<90:
            tp = {"reason":"High GCT or asymmetry indicates tendon/joint stress",
                  "protocol":cn["collagen"],"duration":"12 weeks minimum"}
        return {
            "country":country,"pre_run_foods":cn["pre_run"],"post_run_recovery":cn["post_run"],
            "daily_foods":cn["daily"],"hydration":cn["hydration"],"anti_inflammatory":cn["anti_inf"],
            "supplements":cn["supplements"],"budget_meal":cn["budget"],"tendon_protocol":tp,
            "timing":{"pre_run":"Carbs 1-2 hours before, avoid high fat/fibre",
                      "post_run_30min":"25-35g protein + 50-70g carbs within 30 min",
                      "daily":"1.6-2.0g protein per kg bodyweight across 4 meals"},
        }

    def _country_data(self, country):
        if country=="india":
            return {
                "pre_run":["Idli with sambar (2-3 hrs before)","Banana (30-60 min before)","Poha with peanuts","Ragi dosa"],
                "post_run":["Paneer bhurji + rice (25g protein)","Dal + rice + curd","Soya chunks + chapati","Banana + curd + peanut butter shake"],
                "daily":["Moong dal","Rajma-chawal","Spinach sabzi (iron)","Chana salad","Sweet potato"],
                "hydration":["Coconut water — natural electrolytes","Buttermilk/chaas","Jaljeera","Lemon water + pink salt (natural ORS)"],
                "anti_inf":["Turmeric haldi milk + black pepper daily","Fresh ginger in tea/food","Amla juice for vitamin C","Beetroot juice 250ml pre-run"],
                "collagen":"Amla juice (natural vitamin C) + glycine 5g, 30 min before morning run. Non-veg: bone broth weekly.",
                "budget":"Banana + curd + peanut butter + oats: 25g protein, 60g carbs, under Rs 50",
                "supplements":[
                    {"name":"Ashwagandha","dose":"300-600mg daily","reason":"VO2max improvement + cortisol reduction"},
                    {"name":"Amla/Vitamin C","dose":"500mg natural","reason":"Collagen synthesis + iron absorption"},
                    {"name":"Vitamin D3","dose":"2000 IU daily","reason":"Bone health — deficiency common in India"},
                    {"name":"Iron (if tested low)","dose":"Blood test first","reason":"Common in Indian female runners"},
                ],
            }
        elif country=="usa":
            return {
                "pre_run":["Oatmeal + banana + almond butter","Whole grain toast + peanut butter + honey","Greek yoghurt + granola + berries","Bagel + cream cheese (race day)"],
                "post_run":["Chocolate milk — clinical gold standard (15g protein, 26g carbs)","Chicken breast + sweet potato","Greek yoghurt + berries + granola","Whey protein shake + banana"],
                "daily":["Wild salmon 3×/week (omega-3)","Blueberries daily (antioxidants)","Eggs daily","Sweet potato","Tuna","Cottage cheese before sleep"],
                "hydration":["Electrolyte drink: Nuun or LMNT","Coconut water","500ml water 2 hrs pre-run","150-250ml every 15-20 min during run"],
                "anti_inf":["Tart cherry juice 480ml daily — reduces DOMS 30%","Turmeric golden milk","Wild salmon 3×/week","Dark chocolate 70%+ 30g daily"],
                "collagen":"15g collagen peptides + 500mg vitamin C, 30-60 min before morning run.",
                "budget":"5oz tuna + brown rice + frozen broccoli + olive oil: 40g protein, 60g carbs, under $4",
                "supplements":[
                    {"name":"Creatine monohydrate","dose":"3-5g daily","reason":"Sprint performance + recovery"},
                    {"name":"Caffeine","dose":"3-6mg/kg 30-60 min pre-run","reason":"Endurance performance +3-7%"},
                    {"name":"Collagen + Vitamin C","dose":"15g + 500mg pre-run","reason":"Tendon collagen synthesis"},
                    {"name":"Omega-3 fish oil","dose":"2-3g EPA+DHA daily","reason":"Inflammation reduction"},
                    {"name":"Tart cherry extract","dose":"480mg or 480ml juice","reason":"DOMS reduction 30%"},
                    {"name":"Magnesium glycinate","dose":"300-400mg before sleep","reason":"Cramp prevention + sleep quality"},
                ],
            }
        else:  # japan
            return {
                "pre_run":["Onigiri (1-2 rice balls) + green tea","Soba noodles with light broth","Banana + miso soup","Mochi — race day carb loading"],
                "post_run":["Grilled salmon + rice + miso soup","2 onsen tamago + soy milk + edamame (20g protein)","Natto + rice + pickled vegetables","Amazake post-race"],
                "daily":["Natto daily (K2, nattokinase, protein)","Seaweed salad (iodine, fucoxanthin)","Edamame (complete protein)","Mackerel or salmon","Umeboshi 1-2 daily"],
                "hydration":["Pocari Sweat during runs (precise Na/K ratio)","Green tea before short runs","Miso soup post-run (sodium + probiotics)","Umeboshi in water — traditional sports drink"],
                "anti_inf":["Matcha green tea 3-5 cups daily","Fresh ginger in miso or food","Seaweed — fucoxanthin","Yuzu citrus hot water (vitamin C)","Wasabi — allyl isothiocyanate"],
                "collagen":"5-10g fish collagen peptides (gyoyo collagen) + yuzu vitamin C daily morning. Traditional: fish skin stew weekly.",
                "budget":"Salmon onigiri (¥150) + miso soup (¥50) + edamame (¥100) + green tea = complete recovery under ¥400",
                "supplements":[
                    {"name":"Fish collagen peptides","dose":"5-10g daily","reason":"Japan leads in fish collagen research — tendon + cartilage"},
                    {"name":"Vitamin C (yuzu/amla)","dose":"500mg with collagen","reason":"Essential co-factor for collagen synthesis"},
                    {"name":"Vitamin D3","dose":"2000 IU daily","reason":"Indoor lifestyle — deficiency risk"},
                    {"name":"B12 (plant-based only)","dose":"1000mcg daily","reason":"Mandatory for strict plant-based athletes"},
                ],
            }

    def _risk(self, m):
        risks, score = [], 0
        if m.get("cadence",180)<160: risks.append("Low cadence — shin splint and stress fracture risk"); score+=2
        if m.get("ground_contact_time",0.22)>0.30: risks.append("High GCT — Achilles tendinopathy and plantar fasciitis risk"); score+=2
        if m.get("symmetry",100)<85: risks.append("Significant asymmetry — IT band and knee injury risk"); score+=3
        elif m.get("symmetry",100)<95: risks.append("Minor asymmetry — monitor, strengthen weaker side"); score+=1
        if m.get("torso_lean",10)>15: risks.append("Excessive lean — lumbar stress and hip flexor tightness"); score+=1
        if m.get("foot_strike","Midfoot")=="Heel": risks.append("Heel striking — patellofemoral and shin pain risk"); score+=1
        level = "High" if score>=5 else "Moderate" if score>=3 else "Low"
        return {"level":level,"risk_score":score,"factors":risks,
                "advice":("Reduce training load 40% and consult a sports physiotherapist." if level=="High"
                          else "Reduce intensity 20%. Complete drill plan before adding mileage." if level=="Moderate"
                          else "Continue current training. Maintain consistent drill work.")}


class RAGCoachEngine:
    def __init__(self, country="india"):
        self.country = country.lower()
        if self.country not in SUPPORTED: self.country = "india"
        docs = load_kb(self.country)
        self.retriever = TFIDFRetriever()
        self.retriever.build(docs)
        self.llm = TemplateLLM()
        print(f"[RAG] Ready | country={self.country} | chunks={len(docs)}")

    def _detect_errors(self, metrics):
        errors = []
        if metrics.get("cadence",180)<170: errors.append("cadence_low")
        if metrics.get("ground_contact_time",0.22)>0.25: errors.append("gct_high")
        if metrics.get("symmetry",100)<95: errors.append("symmetry_low")
        if metrics.get("torso_lean",10)>12: errors.append("torso_lean_high")
        if metrics.get("running_efficiency",100)<85: errors.append("efficiency_low")
        if metrics.get("foot_strike","Midfoot")=="Heel": errors.append("foot_strike_heel")
        if metrics.get("stride_length",1.2)<0.9: errors.append("stride_short")
        return errors

    def _retrieve(self, errors):
        bio, drills, nut = [], [], []
        for e in errors[:3]:
            q = ERROR_QUERIES.get(e, e.replace("_"," "))
            bio    += [r["text"] for r in self.retriever.retrieve(q,2,"biomechanics")]
            drills += [r["text"] for r in self.retriever.retrieve(q,2,"drills")]
        for q in ["protein muscle recovery","anti inflammatory food","collagen tendon"]:
            nut += [r["text"] for r in self.retriever.retrieve(q,2,"nutrition")]
        return {
            "biomechanics":"\n\n".join(dict.fromkeys(bio)),
            "drills":"\n\n".join(dict.fromkeys(drills)),
            "nutrition":"\n\n".join(dict.fromkeys(nut)),
        }

    def run(self, metrics, mki):
        errors  = self._detect_errors(metrics)
        context = self._retrieve(errors)
        out = self.llm.generate({
            "metrics":metrics,"mki":mki,"errors":errors,"country":self.country,
            "biomechanics_context":context["biomechanics"],
            "drills_context":context["drills"],
            "nutrition_context":context["nutrition"],
        })
        out["errors_detected"] = errors
        out["retrieval_log"]   = {k:len(v) for k,v in context.items()}
        print(f"[RAG] Done | errors={errors} | drills={len(out.get('drill_plan',[]))}")
        return out
