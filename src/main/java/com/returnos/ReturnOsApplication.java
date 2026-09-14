package com.returnos;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan("com.returnos")
public class ReturnOsApplication {

    public static void main(String[] args) {
        SpringApplication.run(ReturnOsApplication.class, args);
    }
}
