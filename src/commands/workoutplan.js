export default {
  name: 'workoutplan',
  description: 'Get a workout plan',
  group: 'fitness',
  slash: { type: 'subcommand', options: [{ name: 'type', type: 3, description: 'push/pull/legs/general', required: false }] },
  execute: async (context, message, args) => {
    const type = args[0]?.toLowerCase() || 'general';
    const workouts = {
      push: "**PUSH DAY**\n• Push-ups: 3x10-15\n• Pike push-ups: 3x8-12\n• Tricep dips: 3x10-15\n• Plank: 3x30-60s",
      pull: "**PULL DAY**\n• Pull-ups/Chin-ups: 3x5-10\n• Inverted rows: 3x8-12\n• Superman: 3x15\n• Dead hang: 3x20-30s",
      legs: "**LEG DAY**\n• Squats: 3x15-20\n• Lunges: 3x10 each leg\n• Calf raises: 3x20\n• Wall sit: 3x30-45s",
      general: "**FULL BODY**\n• Squats: 3x15\n• Push-ups: 3x10\n• Plank: 3x30s\n• Jumping jacks: 3x20"
    };
    const workout = workouts[type] || workouts.general;
    return message.reply(`🏋️ **Your Workout Plan:**\n\n${workout}\n\n*Rest 60-90 seconds between sets*`);
  }
};
