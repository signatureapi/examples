package com.example.tutorial;

import java.time.Clock;
import java.util.function.Function;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.Environment;

@SpringBootApplication
public class TutorialApplication {
  public static void main(String[] args) {
    SpringApplication.run(TutorialApplication.class, args);
  }

  @Bean
  Clock clock() {
    return Clock.systemUTC();
  }

  // Spring reads environment variables through Environment. Fails fast without a test key.
  @Bean
  SignatureApi.Settings settings(Environment env) {
    Function<String, String> get = name -> env.getProperty(name, "");
    return SignatureApi.Settings.from(get);
  }
}
