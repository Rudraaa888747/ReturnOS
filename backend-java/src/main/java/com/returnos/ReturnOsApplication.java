package com.returnos;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class ReturnOsApplication {
  public static void main(String[] args) { SpringApplication.run(ReturnOsApplication.class, args); }
}
