# Register-matching live eval

**Model:** `google/gemini-3-flash-preview`
**Date:** 2026-05-02T16:14:26.652Z

## Per-message comparison

### opening — light

> I don't really know what to talk about today. Just felt like writing.

| Case | Words | Max sent | Jargon hits | Response |
|---|---|---|---|---|
| tier=plain | 18 | 11 | — | Sometimes just showing up is the work. How does it feel to be here with nothing to do? |
| tier=conversational | 33 | 12 | — | That is a good enough reason to be here. Sometimes the best things come up when we aren't planning for them. What is happening in your body right now as you sit there? |
| tier=literate | 28 | 11 | — | That is a good enough reason to be here. Sometimes the best things come up when there is no plan. What is happening in your body right now? |
| tier=scholarly | 25 | 16 | — | Sometimes just showing up is the most important part. What do you notice in your body as you sit there with nothing specific to say? |
| tier=scholarly + voice (expect ~conversational) | 26 | 10 | — | That is more than enough for today. We can just sit here together for a bit. What is it like to show up without a plan? |
| tier=literate + grounding (expect ~conversational) | 30 | 11 | — | Sometimes it's nice to just show up without a plan. We can sit here together and see what happens. What do you feel in your body as you're writing this? |

### mid — abstract reach

> I keep thinking about how the version of me that shows up at work is barely related to the one that shows up here. It feels like a translation problem, or a costume that's gotten too convincing.

| Case | Words | Max sent | Jargon hits | Response |
|---|---|---|---|---|
| tier=plain | 40 | 17 | — | That costume sounds like it takes a lot of energy to wear. It makes sense that you feel far away from yourself there.  How does your body feel when you take that suit off at the end of the day? |
| tier=conversational | 29 | 10 | — | That costume must feel heavy after a full day. It sounds like you are losing yourself in the performance.  Does that professional version of you feel like a stranger? |
| tier=literate | 46 | 17 | — | The costume might be doing its job a little too well if you feel lost inside it. It makes sense to wonder where the real you goes when you're at your desk.  What happens if you try to loosen one small part of that outfit tomorrow? |
| tier=scholarly | 36 | 19 | — | The costume might feel heavy if you have to wear it all day. Is there a specific moment lately when the "work version" felt especially far away from who you actually are? Say more about that. |
| tier=scholarly + voice (expect ~conversational) | 42 | 15 | — | That costume must feel heavy to take off at the end of the day. It sounds like you're playing a role just to get through the shift.  What happens to the version of you I see here when you're at your desk? |
| tier=literate + grounding (expect ~conversational) | 22 | 17 | — | That sounds exhausting to carry. Does it feel like you might lose yourself if you keep that costume on for too long? |

### mid — plain pain

> I can't sleep again. Just lying there, mad at myself for not being able to sleep.

| Case | Words | Max sent | Jargon hits | Response |
|---|---|---|---|---|
| tier=plain | 27 | 10 | — | Being mad at yourself makes it even harder to rest. It feels like a loop that won't stop.  What is the anger saying to you right now? |
| tier=conversational | 26 | 15 | — | The anger feels like it's trying to force you into resting.  What does that part of you say when you're just lying there in the dark? |
| tier=literate | 35 | 15 | — | That anger at yourself is a heavy thing to carry at three in the morning. It usually has a lot to say when the room gets quiet. What is that voice telling you right now? |
| tier=scholarly | 37 | 14 | — | That anger at yourself can be so loud in the middle of the night. It feels like a heavy weight when you just want to rest. What is that part of you saying while you lie there? |
| tier=scholarly + voice (expect ~conversational) | 41 | 18 | — | That anger is a heavy thing to carry at three in the morning. It sounds like a part of you is really coming down hard on you for just being awake.  What is that angry voice saying to you right now? |
| tier=literate + grounding (expect ~conversational) | 26 | 11 | — | It is hard to rest when you are fighting with yourself. That anger usually has a lot to say. What is it telling you right now? |

### mid — academic register

> There's a particular phenomenology to the avoidance — it isn't quite procrastination, more like a deliberate myopia. I notice myself narrowing focus to the next 30 minutes specifically to avoid contemplating the longer arc.

| Case | Words | Max sent | Jargon hits | Response |
|---|---|---|---|---|
| tier=plain | 31 | 11 | — | Focusing on the next half hour feels like a shield. It keeps the bigger picture from pressing in on you. What are you afraid would happen if you looked further ahead? |
| tier=conversational | 40 | 16 | — | It makes sense that you would shrink your world down to just the next half hour. Looking at the bigger picture can feel like staring at the sun.  What happens in your body when you try to look further out? |
| tier=literate | 44 | 21 | — | That narrowing feels like a way to keep the walls close so you don't have to look at the open horizon. It seems like a very active choice to stay in the small view. What are you afraid you'll see if you zoom out? |
| tier=scholarly | 28 | 15 | — | That narrowing seems like a very effective way to stay in the present. If you looked further out, what do you think would be waiting for you there? |
| tier=scholarly + voice (expect ~conversational) | 43 | 19 | — | Keeping your eyes on the next half hour sounds like a way to stay safe from the big picture. It seems like looking further ahead feels dangerous right now.  What happens in your body when you try to look past those thirty minutes? |
| tier=literate + grounding (expect ~conversational) | 31 | 15 | — | That makes sense. It sounds like looking too far ahead feels like too much right now. What happens in your body when you try to look past that thirty minute window? |

### distress — soft signal

> I just want to disappear for a while. Not anything dramatic, just gone.

| Case | Words | Max sent | Jargon hits | Response |
|---|---|---|---|---|
| tier=plain | 19 | 12 | — | When you say gone, do you mean taking a break from people?  Or do you mean something more permanent? |
| tier=conversational | 21 | 21 | — | When you say you want to be gone, do you mean you need a break from people, or something more permanent? |
| tier=literate | 33 | 20 | — | That feeling of wanting to be gone can take a few different shapes. When you say disappear, do you mean you need a break from your life, or is it something more final? |
| tier=scholarly | 26 | 16 | — | When you say you want to be gone, what does that look like in your head? Is it a long sleep, or is it something else? |
| tier=scholarly + voice (expect ~conversational) | 24 | 13 | — | That feeling of wanting to be gone makes sense when things get heavy. Does disappearing feel like a way to finally get some quiet? |
| tier=literate + grounding (expect ~conversational) | 31 | 18 | — | That feeling of wanting to be gone makes sense when things get heavy. Does it feel more like a need for a quiet break or a need to stop existing entirely? |

## Aggregate by case

| Case | Avg words | Avg max-sent | Total jargon hits |
|---|---|---|---|
| tier=plain | 27.0 | 12.2 | 0 |
| tier=conversational | 29.8 | 14.8 | 0 |
| tier=literate | 37.2 | 16.8 | 0 |
| tier=scholarly | 30.4 | 16.0 | 0 |
| tier=scholarly + voice (expect ~conversational) | 35.2 | 15.0 | 0 |
| tier=literate + grounding (expect ~conversational) | 28.0 | 14.4 | 0 |
