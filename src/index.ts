import { ApolloServer, gql } from "apollo-server";
import { idArg, queryType, stringArg, subscriptionField } from "nexus";
import { PubSub } from "graphql-subscriptions";
import { makePrismaSchema, prismaObjectType } from "nexus-prisma";
import * as path from "path";
import datamodelInfo from "./generated/nexus-prisma";
import mapAsyncIterator from "./mapAsyncIterator";
import { prisma, Employee } from "./generated/prisma-client";

const pubsub = new PubSub();

const Employee = prismaObjectType({
  name: "Employee",
  description: "Employee is the property of company",
  definition(t) {
    t.prismaFields([
      "email",
      "id",
      "name",
      "updatedAt",
      "photo_url",
      "createdAt",
      {
        name: "employer",
        args: []
      }
    ]);
  }
});

const Employer = prismaObjectType({
  name: "Employer",
  description: "Employer is the owner of company",
  definition(t) {
    t.prismaFields([
      "*",
      {
        name: "employees",
        args: []
      }
    ]);
    t.int("num_employees", {
      description: "Number of employees under a employer",
      resolve: async ({ id }, {}, { prisma }) => {
        const employees = await prisma.employees({
          where: { employer: { id } }
        });
        return employees.length;
      }
    });
  }
});

type EmployeeEvent = "create" | "delete" | "update";

type EmployerEvent = "create" | "delete" | "update";

const EmployeeTopic = {
  identifier: "EMPLOYEE_CHANGE_TOPIC",
  publish: (employee: Employee, event: EmployeeEvent) => {
    pubsub.publish(EmployeeTopic.identifier, { employee, event });
  },
  asyncIterator: () => {
    return mapAsyncIterator(
      pubsub.asyncIterator<{ employee: Employee; event: EmployeeEvent }>(
        EmployeeTopic.identifier
      ),
      value => {
        console.log("Employee reason: ", value.event);
        return value.employee;
      }
    );
  }
};

const Query = prismaObjectType({
  name: "Query",
  definition: t => t.prismaFields(["*"])
});

const Mutation = prismaObjectType({
  name: "Mutation",
  definition: t => {
    t.prismaFields(["*"])
    t.field('createEmployee', {
      type: 'Employee',
      args: {
        name: stringArg(),
        email: stringArg(),
        employer: stringArg(),
      },
      resolve: async (parent, { name, email, employer }, ctx) => {
        const employee = await ctx.prisma.createEmployee({
          name,
          email,
          employer: {connect: {id: employer}}
        })
        if (employee) {
          EmployeeTopic.publish(employee, 'create')
        }
        return employee
      },
    })
    t.field('deleteEmployee', {
      type: 'Employee',
      args: {
        id: stringArg(),
      },
      resolve: async (parent, { id }, ctx) => {
        const employee = await ctx.prisma.deleteEmployee({
          id
        })
        if (employee) {
          EmployeeTopic.publish(employee, 'delete')
        }
        return employee
      },
    })
  }
});

// This creates a global Subscription type that has a field post which yields an async iterator
export const SubscriptionEmployee = subscriptionField("employees", {
  type: "Employee",
  subscribe(root, args, ctx) {
    return ctx.prisma.$subscribe.employee(
     { mutation_in: ['CREATED'],
      node: {
        employer: {
          id: 'cjx35nz2eg78g0b12sneo6jzo'
        }
      }}
    ).node()
  },
  resolve(payload) {
    return payload;
  }
});

const schema = makePrismaSchema({
  // Provide all the GraphQL types we've implemented
  types: [Query, Mutation, Employer, Employee, SubscriptionEmployee],

  // Configure the interface to Prisma
  prisma: {
    datamodelInfo,
    client: prisma
  },

  // Specify where Nexus should put the generated files
  outputs: {
    schema: path.join(__dirname, "./generated/schema.graphql"),
    typegen: path.join(__dirname, "./generated/nexus.ts")
  },

  // Configure nullability of input arguments: All arguments are non-nullable by default
  nonNullDefaults: {
    input: false,
    output: false
  },

  // Configure automatic type resolution for the TS representations of the associated types
  typegenAutoConfig: {
    sources: [
      {
        source: path.join(__dirname, "./types.ts"),
        alias: "types"
      }
    ],
    contextType: "types.Context"
  }
});

const server = new ApolloServer({
  schema,
  context: {
    prisma,
    pubsub
  }
});

server.listen({ port: 4000 }, () =>
  console.log(`🚀 Server ready at http://localhost:4000`)
);
