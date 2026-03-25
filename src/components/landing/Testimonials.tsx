import { motion } from "framer-motion";
import { Star } from "lucide-react";

const testimonials = [
  {
    name: "Marco R.",
    role: "Studente universitario, ADHD",
    text: "Ho provato Algor e Quizlet, ma nessuno aveva il timer Pomodoro integrato e la modalità ADHD. FocusED è l'unica app che capisce come funziona il mio cervello.",
    stars: 5,
  },
  {
    name: "Giulia T.",
    role: "Studentessa di Medicina",
    text: "Carico le slide del professore e in 30 secondi ho quiz, flashcard e riassunti pronti. Ho risparmiato ore di studio ogni settimana.",
    stars: 5,
  },
  {
    name: "Alessandro P.",
    role: "Studente di Giurisprudenza",
    text: "Il sistema di streak e badge mi tiene motivato ogni giorno. Non ho mai avuto una routine di studio così costante prima d'ora.",
    stars: 5,
  },
];

const Testimonials = () => {
  return (
    <section className="py-20 md:py-28 bg-secondary/30">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground">
            Amato da studenti in tutta Italia
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Unisciti a migliaia di studenti che hanno trasformato il loro modo di studiare.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              className="bg-card rounded-xl border border-border p-6 shadow-card"
            >
              <div className="flex gap-0.5 mb-4">
                {Array.from({ length: t.stars }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-accent text-accent" />
                ))}
              </div>
              <p className="text-sm text-card-foreground leading-relaxed mb-4">"{t.text}"</p>
              <div>
                <p className="text-sm font-semibold text-card-foreground">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.role}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Social proof stats */}
        <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto text-center">
          {[
            { value: "5,000+", label: "Studenti attivi" },
            { value: "150,000+", label: "Quiz generati" },
            { value: "4.8/5", label: "Valutazione media" },
            { value: "98%", label: "Tasso di soddisfazione" },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            >
              <p className="text-2xl md:text-3xl font-bold text-primary">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
